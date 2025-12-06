/**
 * Compresses and resizes an image file to a base64 string.
 * Optimized for LLM vision context (max 1024px, 0.7 quality).
 */
export const processImageAttachment = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1024;
        const MAX_HEIGHT = 1024;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            reject(new Error("Could not get canvas context"));
            return;
        }
        
        ctx.drawImage(img, 0, 0, width, height);
        
        // Compress to JPEG at 0.7 quality
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        resolve(dataUrl);
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

/**
 * Generic file processor for multimodal inputs (Audio, etc)
 */
export const processFileAttachment = async (file: File): Promise<string> => {
    if (file.type.startsWith('image/')) {
        return processImageAttachment(file);
    }
    
    // For audio, we just return the base64 data URL directly
    // Note: Gemini has size limits, but typical voice memos < 5MB are fine.
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
};

/**
 * Strips the data:image/...;base64, prefix for API usage
 */
export const stripBase64Prefix = (dataUrl: string): string => {
    if (!dataUrl.includes(',')) return dataUrl;
    return dataUrl.split(',')[1];
};

/**
 * Extracts mime type from data URL
 */
export const getMimeType = (dataUrl: string): string => {
    if (!dataUrl.startsWith('data:')) return 'application/octet-stream';
    return dataUrl.split(';')[0].split(':')[1];
};