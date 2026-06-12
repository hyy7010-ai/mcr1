/**
 * Service to handle Google Drive API interactions
 */

export const googleDriveService = {
  /**
   * Upload a blob to Google Drive
   * @param blob The file content
   * @param fileName The name of the file
   * @param accessToken Google OAuth Access Token
   */
  async uploadFile(blob: Blob, fileName: string, accessToken: string) {
    const metadata = {
      name: fileName,
      mimeType: blob.type,
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', blob);

    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: form,
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Google Drive Upload Failed: ${errorData.error?.message || response.statusText}`);
    }

    return await response.json();
  }
};
