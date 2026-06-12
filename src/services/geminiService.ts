import { GoogleGenAI, Type } from "@google/genai";

const genAI = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY || '' });

// ── Grace AI proxy (Supabase Edge Function) ───────────────────────────────────
// The browser cannot call NVIDIA directly (no CORS on preflight), so we route
// through a Supabase Edge Function that holds the API key server-side.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const GRACE_AI_ENDPOINT = `${SUPABASE_URL}/functions/v1/grace-ai`;

export type ChatTurn = { role: 'system' | 'user' | 'assistant'; content: string };

// ── Text helper — calls the proxy with a full messages array (enables memory) ──
async function nvidiaChat(messages: ChatTurn[]): Promise<string> {
  if (!SUPABASE_URL) {
    throw new Error('VITE_SUPABASE_URL is not configured.');
  }
  const res = await fetch(GRACE_AI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_ANON}`,
      'apikey': SUPABASE_ANON,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages,
      temperature: 0.4,
      max_tokens: 2048,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Grace AI proxy error (${res.status}): ${err}`);
  }
  const data = await res.json();
  if (data?.error) throw new Error(data.error);
  return data.choices?.[0]?.message?.content || '';
}

function parseModelResponse(text: string | undefined): any {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) || text.match(/```\n?([\s\S]*?)\n?```/);
    if (jsonMatch?.[1]) {
      try { return JSON.parse(jsonMatch[1]); } catch {}
    }
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try { return JSON.parse(text.substring(start, end + 1)); } catch {}
    }
    return { message: text };
  }
}

// ── Grace Assistant (uses NVIDIA via proxy) ───────────────────────────────────
// `history` is the prior conversation (newest-first, as stored in the UI). It is
// converted to chronological chat turns so the assistant remembers the context.
export const askGraceAIV2 = async (
  prompt: string,
  context: string = "",
  language: string = 'en',
  history: { q: string; a: string }[] = [],
) => {
  try {
    const isZh = language.startsWith('zh');
    const systemPrompt = `You are "GraceButler", an omniscient, refined church steward for GraceFlow.
You know every detail of the church, its members, schedules, and operations.

KNOWLEDGE BASE (Current Church Data):
${context}

OBJECTIVES:
1. Answer questions about church members and their relationships.
2. Help with scheduling (Rosters). Explain how to use the Roster page.
3. Provide navigation suggestions when helpful.

LANGUAGE: Always respond in ${isZh ? 'Chinese (Simplified)' : 'English'}.

NAVIGATION: If the user asks about roster/schedule → suggest /app/roster. Members/network → /app/members. Tasks → /app/tasks. Giving → /app/giving.

Respond ONLY as valid JSON: {"message": "your response text", "action": {"label": "button label", "path": "/app/path"}}
If no navigation action needed, omit the action field or set it to null.
Style: Elegant, helpful, steward-like.`;

    // Last 6 exchanges, oldest-first, as chat turns (gives the assistant memory).
    const historyTurns: ChatTurn[] = history
      .slice(0, 6)
      .reverse()
      .flatMap(h => ([
        { role: 'user' as const, content: h.q },
        { role: 'assistant' as const, content: h.a },
      ]));

    const raw = await nvidiaChat([
      { role: 'system', content: systemPrompt },
      ...historyTurns,
      { role: 'user', content: prompt },
    ]);
    const parsed = parseModelResponse(raw);
    return {
      message: parsed.message || raw || "I couldn't generate a response.",
      action: parsed.action || null,
    };
  } catch (error) {
    console.error("Grace AI Error:", error);
    return {
      message: `Grace Assistant 暂时无法连接，请稍后再试。(${error instanceof Error ? error.message : 'Unknown error'})`,
      action: null,
    };
  }
};

/** @deprecated Use askGraceAIV2 */
export const askGraceAI = async (prompt: string, context: string = "", language: string = 'en') => {
  const res = await askGraceAIV2(prompt, context, language);
  return res.message;
};

// ── Translation (uses NVIDIA) ─────────────────────────────────────────────────
export async function translateLyrics(text: string, targetLang: string): Promise<string> {
  const langMap: Record<string, string> = { en: 'English', zh: 'Simplified Chinese', 'zh-CN': 'Simplified Chinese', 'zh-TW': 'Traditional Chinese', ko: 'Korean', ja: 'Japanese' };
  const target = langMap[targetLang] || 'English';
  try {
    const result = await nvidiaChat([
      { role: 'system', content: `You are a lyrics translator. Translate song lyrics to ${target}. Keep line breaks exactly as-is. Return ONLY the translated lyrics, no explanation.` },
      { role: 'user', content: text },
    ]);
    return result.trim() || text;
  } catch {
    return text;
  }
}

// ── Bulletin image analysis (uses Gemini — needs vision) ─────────────────────
export async function analyzeBulletinImage(base64DataArray: string[] | string) {
  try {
    const dataArray = Array.isArray(base64DataArray) ? base64DataArray : [base64DataArray];
    const parts: any[] = [
      { text: "这是一部分或全部教会周报的扫描文件（图片或PDF）。请结合所有提供的页面，极其精确、一字不漏地地毯式提取以下内容，保持原样：\n1. 教会全称（title）。\n2. 期数（issueNo）和日期（date）。\n3. 今日经文。出处（scriptureReference）和正文（scriptureText）。\n4. 程序表（schedule）。\n5. 报告事项（announcements）。\n6. 诗歌名称（hymns）。\n7. 【重点任务-绝对完美复刻】：请使用纯粹的 HTML 和强行内样式（Inline Styles, `style=\"...\"`），精确复刻上传的周报中展现的全部视觉排版（Visual Layout）。你需要根据图片中的表格、分栏、边线、位置、字体粗细、文字排版留白等，写出一个结构完美的 HTML 代码区块（绝对不能包含任何 JavaScript 或外部 class 类名依赖，只能使用内联 style 如 `style=\"padding: 12px; border-bottom: 2px solid black; text-align: center; font-family: serif;\"`）。将此复刻生成的 HTML 代码放入 `generatedHtml` 字段中。宽度和高度可以使用百分比以适应容器。排版必须尽可能和原图一模一样（包括留白、对齐、表格线等）。如果包含图片，请留出空白 div 占位即可。" }
    ];

    for (const dataUri of dataArray) {
      const match = dataUri.match(/^data:([a-zA-Z0-9-]+\/[a-zA-Z0-9-\.]+);base64,(.+)$/);
      if (!match) throw new Error("Invalid base64 format");
      parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
    }

    const response = await genAI.models.generateContent({
      model: "gemini-2.0-flash",
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            issueNo: { type: Type.STRING },
            date: { type: Type.STRING },
            sermonTitle: { type: Type.STRING },
            preacher: { type: Type.STRING },
            scriptureReference: { type: Type.STRING },
            scriptureText: { type: Type.STRING },
            hymns: { type: Type.ARRAY, items: { type: Type.STRING } },
            announcements: { type: Type.ARRAY, items: { type: Type.STRING } },
            schedule: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  time: { type: Type.STRING },
                  activity: { type: Type.STRING },
                  action: { type: Type.STRING },
                  person: { type: Type.STRING }
                }
              }
            },
            generatedHtml: { type: Type.STRING }
          }
        }
      },
      contents: [{ role: "user", parts }]
    });

    if (!response.text) return {};
    return parseModelResponse(response.text);
  } catch (error) {
    console.error("Bulletin Analysis Error:", error);
    throw error;
  }
}

// ── Song fetch from URL (uses Gemini — needs vision/knowledge) ────────────────
export async function fetchSongFromUrl(url: string) {
  try {
    let contents = '';
    const youtubeRegex = /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    const ytMatch = url.match(youtubeRegex);

    if (ytMatch) {
      const videoId = ytMatch[1];
      let videoTitle = '';
      let videoDescription = '';

      const oEmbedSources = [
        `https://noembed.com/embed?url=${encodeURIComponent(url)}`,
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      ];
      for (const endpoint of oEmbedSources) {
        if (videoTitle) break;
        try {
          const oRes = await fetch(endpoint, { signal: AbortSignal.timeout(6000) });
          if (oRes.ok) { const oData = await oRes.json(); videoTitle = oData.title || ''; }
        } catch {}
      }

      const proxies = [
        `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
        `https://corsproxy.io/?${encodeURIComponent(url)}`,
      ];
      for (const proxyUrl of proxies) {
        if (videoDescription) break;
        try {
          const pRes = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) });
          if (!pRes.ok) continue;
          const isJson = proxyUrl.includes('allorigins');
          const raw = isJson ? ((await pRes.json()).contents || '') : await pRes.text();
          const shortDescMatch = raw.match(/"shortDescription"\s*:\s*"([\s\S]{20,8000})"/);
          if (shortDescMatch) {
            videoDescription = shortDescMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"')
              .replace(/\\u([\da-fA-F]{4})/g, (_: string, h: string) => String.fromCharCode(parseInt(h, 16))).slice(0, 5000);
          }
          if (!videoDescription || videoDescription.length < 50) {
            const descMatch = raw.match(/"description"\s*:\s*\{"simpleText"\s*:\s*"([\s\S]{20,8000})"/);
            if (descMatch) videoDescription = descMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').slice(0, 5000);
          }
          if (!videoDescription || videoDescription.length < 50) {
            const ogMatch = raw.match(/<meta[^>]+property="og:description"[^>]+content="([^"]{20,3000})"/i);
            if (ogMatch) videoDescription = ogMatch[1];
          }
        } catch {}
      }

      const looksLikeLyrics = videoDescription.length > 80 && (videoDescription.includes('\n') || /[一-鿿]{4}/.test(videoDescription));
      const descPart = videoDescription ? `\n\n===以下是从视频页面提取的文字（可能包含完整歌词）===\n${videoDescription}\n===提取文字结束===` : '';
      const titleInfo = videoTitle ? `标题："${videoTitle}"` : `视频ID: ${videoId}`;
      const hasLyricsInDesc = looksLikeLyrics && descPart;
      contents = `这是一首敬拜赞美诗歌，${titleInfo}（YouTube: ${url}）。${descPart}\n\n任务：提取并整理完整歌词，返回JSON格式。\n\n${hasLyricsInDesc ? `⭐ 上方"提取文字"中已包含歌词内容，请直接从中精确提取。` : `ℹ️ 请根据${videoTitle ? `歌名"${videoTitle}"` : `YouTube链接 ${url}`}从知识库提供完整歌词。`}\n\n规则：\n1. lyrics = 完整中文歌词，所有段落必须包含\n2. englishLyrics = 与lyrics逐行对应的英文\n3. title = 中文歌名，englishTitle = 英文歌名，key = 调性`;
    } else {
      let pageContent = '';
      try {
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
        const response = await fetch(proxyUrl, { signal: AbortSignal.timeout(8000) });
        if (response.ok) {
          const data = await response.json();
          pageContent = (data.contents || '').replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 8000);
        }
      } catch {}
      contents = pageContent
        ? `以下是网页 (${url}) 的文本内容:\n\n${pageContent}\n\n请从以上内容中提取【完整】歌词信息。返回JSON：title, englishTitle, lyrics, englishLyrics, key。`
        : `请根据以下链接推断是什么歌并提供完整歌词：${url}。返回JSON: title, englishTitle, lyrics, englishLyrics, key。`;
    }

    const result = await genAI.models.generateContent({
      model: "gemini-2.0-flash",
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            englishTitle: { type: Type.STRING },
            lyrics: { type: Type.STRING },
            englishLyrics: { type: Type.STRING },
            key: { type: Type.STRING }
          }
        }
      },
      contents
    });
    return parseModelResponse(result.text);
  } catch (error) {
    console.error("Song fetch error:", error);
    throw error;
  }
}
