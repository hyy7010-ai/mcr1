import React, { useState, useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useMode } from '../contexts/ModeContext';
import { useAuth } from '../contexts/AuthContext';
import { getActiveChurchId } from '../lib/permissions';
import { motion } from 'motion/react';

export default function Giving() {
  const { isZh } = useLanguage();
  const { mode } = useMode();
  const { profile, church } = useAuth();
  const activeChurchId = getActiveChurchId(profile, church);
  const churchKey = (base: string) => `${base}_${activeChurchId || 'demo'}`;

  const [bsb, setBsb] = useState('');
  const [accNo, setAccNo] = useState('');
  const [copiedField, setCopiedField] = useState('');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(churchKey('giving_settings'));
      if (saved) {
        const s = JSON.parse(saved);
        if (s.bsb !== undefined) setBsb(s.bsb);
        if (s.accNo !== undefined) setAccNo(s.accNo);
      }
    } catch {}
  }, [activeChurchId]);

  const save = (updates: { bsb?: string; accNo?: string }) => {
    const current = { bsb, accNo, ...updates };
    localStorage.setItem(churchKey('giving_settings'), JSON.stringify(current));
  };

  const copy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(''), 2000);
  };

  return (
    <div className="w-full min-h-screen bg-surface flex items-center justify-center py-12 px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        {/* Header */}
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-secondary-container/30 text-secondary border border-secondary/10">
            <span className="material-symbols-outlined text-3xl filled">favorite</span>
          </div>
          <h1 className="font-serif text-2xl font-black text-on-surface">{isZh ? '十一奉献' : 'Giving'}</h1>
          <p className="mt-2 text-sm text-on-surface-variant">
            "{isZh ? '捐得乐意的人是神所喜爱的。' : 'God loves a cheerful giver.'}" — 2 Cor 9:7
          </p>
        </div>

        {/* Bank transfer card */}
        <div className="rounded-2xl border border-outline-variant/40 bg-white p-6 shadow-lg">
          <p className="text-[10px] font-black uppercase tracking-widest text-outline mb-4 text-center">
            {isZh ? '银行转账' : 'Bank Transfer'}
          </p>

          {/* Account Name */}
          <div className="flex items-center justify-between py-3 border-b border-outline-variant/20">
            <span className="text-sm text-outline">{isZh ? '账户名' : 'Account Name'}</span>
            <span className="text-sm font-semibold text-on-surface">{church?.name || '—'}</span>
          </div>

          {/* BSB */}
          <div className="flex items-center justify-between py-3 border-b border-outline-variant/20">
            <span className="text-sm text-outline">BSB</span>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-on-surface font-mono">{bsb || '—'}</span>
              {bsb && (
                <button onClick={() => copy(bsb, 'bsb')} className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-container border border-outline-variant/40 text-outline hover:text-primary transition-colors">
                  <span className="material-symbols-outlined text-[14px]">{copiedField === 'bsb' ? 'check' : 'content_copy'}</span>
                </button>
              )}
            </div>
          </div>

          {/* Account Number */}
          <div className="flex items-center justify-between py-3">
            <span className="text-sm text-outline">{isZh ? '账号' : 'Account No.'}</span>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-on-surface font-mono">{accNo || '—'}</span>
              {accNo && (
                <button onClick={() => copy(accNo.replace(/\s/g, ''), 'acc')} className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-container border border-outline-variant/40 text-outline hover:text-primary transition-colors">
                  <span className="material-symbols-outlined text-[14px]">{copiedField === 'acc' ? 'check' : 'content_copy'}</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Manager edit section */}
        {mode === 'Manager' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-6 rounded-2xl border border-primary/20 bg-primary/5 p-6"
          >
            <p className="text-[10px] font-black uppercase tracking-widest text-primary mb-4">
              {isZh ? '管理员 — 设置银行信息' : 'Manager — Set Bank Details'}
            </p>
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-[11px] font-bold text-outline uppercase tracking-wider mb-1 block">BSB</label>
                <input
                  type="text"
                  value={bsb}
                  onChange={e => { setBsb(e.target.value); save({ bsb: e.target.value }); }}
                  placeholder="e.g. 062-123"
                  className="w-full rounded-xl border border-outline-variant bg-white py-3 px-4 font-mono text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-outline uppercase tracking-wider mb-1 block">
                  {isZh ? '账号' : 'Account Number'}
                </label>
                <input
                  type="text"
                  value={accNo}
                  onChange={e => { setAccNo(e.target.value); save({ accNo: e.target.value }); }}
                  placeholder="e.g. 1234 5678"
                  className="w-full rounded-xl border border-outline-variant bg-white py-3 px-4 font-mono text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                />
              </div>
            </div>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
