'use client';

/**
 * ZENNA Avatar V2 - Avatar Settings Panel
 *
 * Comprehensive avatar customization UI with:
 * - Preset avatar selection
 * - Outfit and accessory customization
 * - Color customization (skin, hair, eyes, clothing)
 * - Reference image upload for 3D reconstruction
 * - User guidance for optimal images
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  AvatarModelType,
  AvatarCustomization,
  PresetAvatarModel,
  OutfitOption,
  ReconstructionJob,
  ReconstructionStatus,
  ImageValidation,
  PRESET_AVATARS,
  DEFAULT_OUTFITS,
} from './types';

// =============================================================================
// IMAGE COMPRESSION
// =============================================================================

const MAX_UPLOAD_SIZE = 4 * 1024 * 1024; // 4MB - under Vercel's 4.5MB body limit

/**
 * Compress an image file client-side using Canvas.
 * Preserves transparency by using PNG output but scales down if needed.
 * Falls back to JPEG (lossy) if PNG is still too large.
 */
async function compressImageForUpload(file: File): Promise<File> {
  if (file.size <= MAX_UPLOAD_SIZE) return file;

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      // Scale down to reduce file size while maintaining aspect ratio
      let { width, height } = img;
      const maxDimension = 1536; // Good balance: still high-res but much smaller file

      if (width > maxDimension || height > maxDimension) {
        const scale = maxDimension / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Could not create canvas context')); return; }

      ctx.drawImage(img, 0, 0, width, height);

      // Try PNG first (preserves transparency)
      canvas.toBlob(
        (pngBlob) => {
          if (pngBlob && pngBlob.size <= MAX_UPLOAD_SIZE) {
            resolve(new File([pngBlob], file.name, { type: 'image/png' }));
            return;
          }

          // PNG still too large - try WebP with quality reduction (preserves transparency)
          canvas.toBlob(
            (webpBlob) => {
              if (webpBlob && webpBlob.size <= MAX_UPLOAD_SIZE) {
                const name = file.name.replace(/\.\w+$/, '.webp');
                resolve(new File([webpBlob], name, { type: 'image/webp' }));
                return;
              }

              // Last resort: JPEG at 85% quality (loses transparency but guaranteed small)
              canvas.toBlob(
                (jpegBlob) => {
                  if (jpegBlob) {
                    const name = file.name.replace(/\.\w+$/, '.jpg');
                    resolve(new File([jpegBlob], name, { type: 'image/jpeg' }));
                  } else {
                    reject(new Error('Failed to compress image'));
                  }
                },
                'image/jpeg',
                0.85
              );
            },
            'image/webp',
            0.9
          );
        },
        'image/png'
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for compression'));
    };

    img.src = url;
  });
}

// =============================================================================
// TYPES
// =============================================================================

interface AvatarSettingsProps {
  onClose: () => void;
  onAvatarChange?: (avatarUrl: string, modelType: AvatarModelType) => void;
  initialAvatarUrl?: string;
  initialModelType?: AvatarModelType;
}

interface UploadedImage {
  file: File;
  preview: string;
  validation: ImageValidation;
  angle: 'front' | 'three-quarter' | 'side' | 'back' | 'detail';
}

type SettingsSubTab = 'select' | 'customize' | 'upload' | 'reconstruction' | 'editor';

// Quality preset options
type QualityPreset = 'fast' | 'balanced' | 'quality';

const QUALITY_PRESETS: { id: QualityPreset; name: string; description: string; icon: string }[] = [
  { id: 'fast', name: 'Fast', description: 'Quick preview (~30s)', icon: '⚡' },
  { id: 'balanced', name: 'Balanced', description: 'Good quality (~60s)', icon: '⚖️' },
  { id: 'quality', name: 'High Quality', description: 'Best results (~90s)', icon: '✨' },
];

interface GenerationLimits {
  allowed: boolean;
  remaining: number;
  limit: number;
  used: number;
  isUnlimited: boolean;
  resetsAt: string;
}

// =============================================================================
// COLOR PRESETS
// =============================================================================

const SKIN_TONE_PRESETS = [
  '#FFDBAC', '#F5CBA7', '#E0AC69', '#C68642', '#8D5524', '#5C3317',
  '#FFE0BD', '#FFCD94', '#EAC086', '#D08C5A', '#6B4423', '#3D2314',
];

const HAIR_COLOR_PRESETS = [
  '#090806', '#2C222B', '#3B3024', '#4E433F', '#504444', '#6A4E42',
  '#A7856A', '#B89778', '#DCD0BA', '#DEBC99', '#977961', '#E6CEA8',
  '#B55239', '#8D4A43', '#91553D', '#533D32', '#71635A', '#B7A69E',
];

const EYE_COLOR_PRESETS = [
  '#634E34', '#2E536F', '#3D671D', '#497665', '#1C7847', '#7A3B3F',
  '#A8516E', '#6B8E23', '#4169E1', '#8B4513', '#2F4F4F', '#708090',
];

// =============================================================================
// AVATAR SETTINGS COMPONENT
// =============================================================================

export default function AvatarSettings({
  onClose,
  onAvatarChange,
  initialAvatarUrl,
  initialModelType = 'preset',
}: AvatarSettingsProps) {
  // Tab state
  const [activeTab, setActiveTab] = useState<SettingsSubTab>('select');

  // Selection state
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [selectedOutfit, setSelectedOutfit] = useState<string | null>(null);

  // Customization state
  const [customization, setCustomization] = useState<AvatarCustomization>({});

  // Upload state
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Reconstruction state
  const [reconstructionJob, setReconstructionJob] = useState<ReconstructionJob | null>(null);
  const [isStartingReconstruction, setIsStartingReconstruction] = useState(false);

  // Quality preset state
  const [selectedQuality, setSelectedQuality] = useState<QualityPreset>('balanced');

  // Generation limits state
  const [generationLimits, setGenerationLimits] = useState<GenerationLimits | null>(null);
  const [isLoadingLimits, setIsLoadingLimits] = useState(true);

  // Message state
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);

  // =============================================================================
  // LOAD GENERATION LIMITS
  // =============================================================================

  useEffect(() => {
    async function loadLimits() {
      try {
        const response = await fetch('/api/avatar/limits');
        if (response.ok) {
          const data = await response.json();
          setGenerationLimits(data);
        }
      } catch (error) {
        console.error('Failed to load generation limits:', error);
      } finally {
        setIsLoadingLimits(false);
      }
    }
    loadLimits();
  }, []);

  // =============================================================================
  // PRESET SELECTION
  // =============================================================================

  const handlePresetSelect = useCallback(async (preset: PresetAvatarModel) => {
    setSelectedPreset(preset.id);
    setMessage({ type: 'info', text: `Selected: ${preset.name}` });

    // Notify parent
    onAvatarChange?.(preset.modelUrl, 'preset');
  }, [onAvatarChange]);

  // =============================================================================
  // OUTFIT SELECTION
  // =============================================================================

  const handleOutfitSelect = useCallback((outfit: OutfitOption) => {
    setSelectedOutfit(outfit.id);
    setCustomization(prev => ({
      ...prev,
      outfitId: outfit.id,
      topColor: outfit.colors.primary,
      bottomColor: outfit.colors.secondary,
    }));
  }, []);

  // =============================================================================
  // COLOR CUSTOMIZATION
  // =============================================================================

  const handleColorChange = useCallback((type: keyof AvatarCustomization, color: string) => {
    setCustomization(prev => ({ ...prev, [type]: color }));
  }, []);

  // =============================================================================
  // IMAGE VALIDATION
  // =============================================================================

  const validateImage = useCallback(async (file: File): Promise<ImageValidation> => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check file type
    const validTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      errors.push('Invalid file type. Use PNG, JPEG, or WebP.');
    }

    // Check file size (max 10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      errors.push('File too large. Maximum size is 10MB.');
    }

    // Load image to check dimensions and transparency
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        const width = img.width;
        const height = img.height;

        // Check minimum resolution
        if (width < 1024 || height < 1024) {
          warnings.push(`Low resolution (${width}x${height}). Minimum 1024x1024 recommended.`);
        }

        // Check for transparency (PNG only)
        let hasTransparency = false;
        if (file.type === 'image/png') {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            for (let i = 3; i < imageData.data.length; i += 4) {
              if (imageData.data[i] < 255) {
                hasTransparency = true;
                break;
              }
            }
          }
        }

        if (!hasTransparency && file.type === 'image/png') {
          warnings.push('No transparency detected. Consider removing the background.');
        }

        URL.revokeObjectURL(url);

        resolve({
          valid: errors.length === 0,
          width,
          height,
          hasTransparency,
          format: file.type,
          fileSize: file.size,
          errors,
          warnings,
        });
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({
          valid: false,
          width: 0,
          height: 0,
          hasTransparency: false,
          format: file.type,
          fileSize: file.size,
          errors: ['Failed to load image.'],
          warnings: [],
        });
      };

      img.src = url;
    });
  }, []);

  // =============================================================================
  // IMAGE UPLOAD
  // =============================================================================

  const handleFileSelect = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setUploadError(null);

    const newImages: UploadedImage[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const validation = await validateImage(file);

      if (validation.valid || validation.warnings.length > 0) {
        const preview = URL.createObjectURL(file);
        newImages.push({
          file,
          preview,
          validation,
          angle: i === 0 ? 'front' : i === 1 ? 'three-quarter' : i === 2 ? 'side' : 'detail',
        });
      } else {
        setUploadError(validation.errors.join(' '));
      }
    }

    setUploadedImages(prev => [...prev, ...newImages]);
    setIsUploading(false);
  }, [validateImage]);

  const handleRemoveImage = useCallback((index: number) => {
    setUploadedImages(prev => {
      const newImages = [...prev];
      URL.revokeObjectURL(newImages[index].preview);
      newImages.splice(index, 1);
      return newImages;
    });
  }, []);

  const handleAngleChange = useCallback((index: number, angle: UploadedImage['angle']) => {
    setUploadedImages(prev => {
      const newImages = [...prev];
      newImages[index] = { ...newImages[index], angle };
      return newImages;
    });
  }, []);

  // =============================================================================
  // START RECONSTRUCTION
  // =============================================================================

  const startReconstruction = useCallback(async () => {
    if (uploadedImages.length === 0) {
      setMessage({ type: 'error', text: 'Please upload at least one reference image.' });
      return;
    }

    // Check generation limits
    if (generationLimits && !generationLimits.allowed && !generationLimits.isUnlimited) {
      setMessage({
        type: 'error',
        text: `Monthly generation limit reached (${generationLimits.limit}/month). Your limit resets on ${new Date(generationLimits.resetsAt).toLocaleDateString()}.`,
      });
      return;
    }

    setIsStartingReconstruction(true);
    setMessage(null);

    try {
      // Upload images individually to avoid Vercel's 4.5MB body size limit
      setMessage({ type: 'info', text: `Uploading ${uploadedImages.length} image(s)...` });
      const imageUrls: string[] = [];

      for (let i = 0; i < uploadedImages.length; i++) {
        const img = uploadedImages[i];

        // Compress large images client-side to stay under Vercel's 4.5MB body limit
        let fileToUpload = img.file;
        if (fileToUpload.size > MAX_UPLOAD_SIZE) {
          setMessage({ type: 'info', text: `Compressing image ${i + 1} (${(fileToUpload.size / 1024 / 1024).toFixed(1)}MB)...` });
          fileToUpload = await compressImageForUpload(fileToUpload);
        }

        setMessage({ type: 'info', text: `Uploading image ${i + 1} of ${uploadedImages.length} (${(fileToUpload.size / 1024 / 1024).toFixed(1)}MB)...` });

        const formData = new FormData();
        formData.append('image', fileToUpload);
        formData.append('angle', img.angle);

        const uploadResponse = await fetch('/api/avatar/upload', {
          method: 'POST',
          body: formData,
        });

        if (!uploadResponse.ok) {
          const errorText = await uploadResponse.text();
          let errorMsg = `Failed to upload image ${i + 1} (HTTP ${uploadResponse.status}).`;
          try {
            const errorData = JSON.parse(errorText);
            errorMsg = errorData.error || errorMsg;
          } catch {
            if (uploadResponse.status === 413) {
              errorMsg = `Image ${i + 1} is too large for the server (${(img.file.size / 1024 / 1024).toFixed(1)}MB). Try compressing or resizing the image.`;
            } else if (uploadResponse.status === 504 || uploadResponse.status === 408) {
              errorMsg = `Image ${i + 1} upload timed out (${(img.file.size / 1024 / 1024).toFixed(1)}MB). Try a smaller image.`;
            } else {
              errorMsg = `Failed to upload image ${i + 1}: HTTP ${uploadResponse.status} - ${errorText.slice(0, 200)}`;
            }
          }
          setMessage({ type: 'error', text: errorMsg });
          return;
        }

        const uploadData = await uploadResponse.json();

        if (!uploadData.success) {
          setMessage({ type: 'error', text: uploadData.error || `Failed to upload image ${i + 1}.` });
          return;
        }

        imageUrls.push(uploadData.url);
      }

      // Start reconstruction with pre-uploaded image URLs and quality preset
      setMessage({ type: 'info', text: `Starting 3D reconstruction (${selectedQuality} quality)...` });

      const response = await fetch('/api/avatar/reconstruct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrls,
          qualityPreset: selectedQuality,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setReconstructionJob(data.job);
        setActiveTab('reconstruction');
        // Update limits after successful start
        if (data.limits) {
          setGenerationLimits(prev => prev ? {
            ...prev,
            remaining: data.limits.remaining,
            used: prev.used + 1,
            allowed: data.limits.remaining > 0,
          } : null);
        }
        setMessage({ type: 'success', text: 'Reconstruction started! This may take a few minutes.' });
      } else {
        // Check if limit reached
        if (data.limitReached) {
          setGenerationLimits(prev => prev ? { ...prev, allowed: false, remaining: 0 } : null);
        }
        setMessage({ type: 'error', text: data.error || 'Failed to start reconstruction.' });
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[AvatarSettings] Reconstruction error:', error);
      if (errMsg.includes('Failed to fetch') || errMsg.includes('NetworkError') || errMsg.includes('timeout')) {
        setMessage({ type: 'error', text: 'Network error or timeout during upload. Check browser console for details.' });
      } else {
        setMessage({ type: 'error', text: `Reconstruction failed: ${errMsg}` });
      }
    } finally {
      setIsStartingReconstruction(false);
    }
  }, [uploadedImages]);

  // =============================================================================
  // POLL RECONSTRUCTION STATUS
  // =============================================================================

  useEffect(() => {
    if (!reconstructionJob || reconstructionJob.status === 'complete' || reconstructionJob.status === 'failed') {
      return;
    }

    const pollStatus = async () => {
      try {
        const response = await fetch(`/api/avatar/reconstruct/status?jobId=${reconstructionJob.id}`);
        const data = await response.json();

        if (data.job) {
          setReconstructionJob(data.job);

          if (data.job.status === 'complete' && data.job.outputModelUrl) {
            setMessage({ type: 'success', text: 'Avatar reconstruction complete!' });
            onAvatarChange?.(data.job.outputModelUrl, 'reconstructed');
          } else if (data.job.status === 'failed') {
            setMessage({ type: 'error', text: data.job.error || 'Reconstruction failed.' });
          }
        }
      } catch (error) {
        console.error('Failed to poll reconstruction status:', error);
      }
    };

    const interval = setInterval(pollStatus, 3000);
    return () => clearInterval(interval);
  }, [reconstructionJob, onAvatarChange]);

  // =============================================================================
  // CLEANUP
  // =============================================================================

  useEffect(() => {
    return () => {
      // Cleanup preview URLs
      uploadedImages.forEach(img => URL.revokeObjectURL(img.preview));
    };
  }, []);

  // =============================================================================
  // RENDER TABS
  // =============================================================================

  const tabs: { id: SettingsSubTab; label: string; icon: string }[] = [
    { id: 'select', label: 'Select Avatar', icon: '👤' },
    { id: 'customize', label: 'Customize', icon: '🎨' },
    { id: 'upload', label: 'Set Up My Avatar', icon: '📷' },
  ];

  if (reconstructionJob) {
    tabs.push({ id: 'reconstruction', label: 'Progress', icon: '⚙️' });

    // Add Editor tab only when reconstruction is complete
    if (reconstructionJob.status === 'complete' && reconstructionJob.outputModelUrl) {
      tabs.push({ id: 'editor', label: 'Editor', icon: '✏️' });
    }
  }

  // =============================================================================
  // RENDER
  // =============================================================================

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="glass-card w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-zenna-border flex items-center justify-between">
          <h2 className="text-lg font-medium">Avatar Settings</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-zenna-surface rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zenna-border overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm whitespace-nowrap transition-colors flex items-center gap-2 ${
                activeTab === tab.id
                  ? 'text-white border-b-2 border-zenna-accent'
                  : 'text-zenna-muted hover:text-white'
              }`}
            >
              <span>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Messages */}
          {message && (
            <div className={`mb-4 p-3 rounded-lg text-sm ${
              message.type === 'success'
                ? 'bg-green-500/10 text-green-400'
                : message.type === 'error'
                ? 'bg-red-500/10 text-red-400'
                : 'bg-blue-500/10 text-blue-400'
            }`}>
              {message.text}
            </div>
          )}

          {/* SELECT TAB */}
          {activeTab === 'select' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-medium mb-3">Preset Avatars</h3>
                <div className="grid grid-cols-3 gap-4">
                  {PRESET_AVATARS.map(preset => (
                    <button
                      key={preset.id}
                      onClick={() => handlePresetSelect(preset)}
                      className={`p-4 rounded-lg border transition-all ${
                        selectedPreset === preset.id
                          ? 'border-zenna-accent bg-zenna-accent/10'
                          : 'border-zenna-border hover:border-zenna-accent/50'
                      }`}
                    >
                      <div className="aspect-square bg-zenna-surface rounded-lg mb-2 flex items-center justify-center">
                        <span className="text-4xl">
                          {preset.category === 'realistic' ? '🧑' : preset.category === 'stylized' ? '🤖' : '🔮'}
                        </span>
                      </div>
                      <p className="text-sm font-medium">{preset.name}</p>
                      <p className="text-xs text-zenna-muted">{preset.description}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* CUSTOMIZE TAB */}
          {activeTab === 'customize' && (
            <div className="space-y-6">
              {/* Outfits */}
              <div>
                <h3 className="text-sm font-medium mb-3">Outfit</h3>
                <div className="grid grid-cols-3 gap-4">
                  {DEFAULT_OUTFITS.map(outfit => (
                    <button
                      key={outfit.id}
                      onClick={() => handleOutfitSelect(outfit)}
                      className={`p-4 rounded-lg border transition-all ${
                        selectedOutfit === outfit.id
                          ? 'border-zenna-accent bg-zenna-accent/10'
                          : 'border-zenna-border hover:border-zenna-accent/50'
                      }`}
                    >
                      <div
                        className="aspect-square rounded-lg mb-2"
                        style={{
                          background: `linear-gradient(135deg, ${outfit.colors.primary}, ${outfit.colors.secondary})`,
                        }}
                      />
                      <p className="text-sm font-medium">{outfit.name}</p>
                      <p className="text-xs text-zenna-muted capitalize">{outfit.category}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Skin Tone */}
              <div>
                <h3 className="text-sm font-medium mb-3">Skin Tone</h3>
                <div className="flex flex-wrap gap-2">
                  {SKIN_TONE_PRESETS.map(color => (
                    <button
                      key={color}
                      onClick={() => handleColorChange('skinTone', color)}
                      className={`w-8 h-8 rounded-full border-2 transition-all ${
                        customization.skinTone === color
                          ? 'border-white scale-110'
                          : 'border-transparent hover:border-white/50'
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

              {/* Hair Color */}
              <div>
                <h3 className="text-sm font-medium mb-3">Hair Color</h3>
                <div className="flex flex-wrap gap-2">
                  {HAIR_COLOR_PRESETS.map(color => (
                    <button
                      key={color}
                      onClick={() => handleColorChange('hairColor', color)}
                      className={`w-8 h-8 rounded-full border-2 transition-all ${
                        customization.hairColor === color
                          ? 'border-white scale-110'
                          : 'border-transparent hover:border-white/50'
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

              {/* Eye Color */}
              <div>
                <h3 className="text-sm font-medium mb-3">Eye Color</h3>
                <div className="flex flex-wrap gap-2">
                  {EYE_COLOR_PRESETS.map(color => (
                    <button
                      key={color}
                      onClick={() => handleColorChange('eyeColor', color)}
                      className={`w-8 h-8 rounded-full border-2 transition-all ${
                        customization.eyeColor === color
                          ? 'border-white scale-110'
                          : 'border-transparent hover:border-white/50'
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* UPLOAD TAB - Set Up My Avatar */}
          {activeTab === 'upload' && (
            <div className="space-y-6">
              {/* User Instructions */}
              <div className="bg-gradient-to-br from-zenna-accent/10 to-purple-500/10 border border-zenna-accent/20 rounded-lg p-6">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <span>🌟</span>
                  What Makes a Great Reference Image for Your 3D Avatar
                </h3>
                <p className="text-sm text-zenna-muted mb-6">
                  To generate the most accurate 3D avatar, your images should follow these guidelines:
                </p>

                <div className="grid md:grid-cols-2 gap-6">
                  {/* Column 1 */}
                  <div className="space-y-4">
                    {/* High Resolution */}
                    <div className="flex gap-3">
                      <span className="text-xl">📸</span>
                      <div>
                        <h4 className="font-medium text-sm">1. Use a High-Resolution PNG</h4>
                        <ul className="text-xs text-zenna-muted mt-1 space-y-1">
                          <li>• Minimum: 1024×1024</li>
                          <li>• Ideal: 2048×2048 or higher</li>
                          <li>• PNG with transparent background is best</li>
                          <li className="text-zenna-accent">
                            (Remove backgrounds using <a href="https://www.photopea.com" target="_blank" rel="noopener noreferrer" className="underline">Photopea</a> or similar tools)
                          </li>
                        </ul>
                      </div>
                    </div>

                    {/* Multiple Angles */}
                    <div className="flex gap-3">
                      <span className="text-xl">💡</span>
                      <div>
                        <h4 className="font-medium text-sm">2. Provide Multiple Angles</h4>
                        <p className="text-xs text-zenna-muted mt-1">The more angles you upload, the better the 3D reconstruction.</p>
                        <ul className="text-xs text-zenna-muted mt-1 space-y-1">
                          <li><strong className="text-white">Recommended:</strong></li>
                          <li>• Front view (neutral expression)</li>
                          <li>• ¾ view (left or right)</li>
                          <li>• Side profile</li>
                          <li><strong className="text-white">Optional but helpful:</strong></li>
                          <li>• Back of head</li>
                          <li>• Close-ups of eyes, hair texture</li>
                        </ul>
                      </div>
                    </div>

                    {/* Neutral Lighting */}
                    <div className="flex gap-3">
                      <span className="text-xl">🎭</span>
                      <div>
                        <h4 className="font-medium text-sm">3. Neutral Lighting</h4>
                        <ul className="text-xs text-zenna-muted mt-1 space-y-1">
                          <li>• Soft, even lighting</li>
                          <li>• No harsh shadows</li>
                          <li>• No colored lighting</li>
                          <li>• Avoid backlighting</li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  {/* Column 2 */}
                  <div className="space-y-4">
                    {/* Neutral Pose */}
                    <div className="flex gap-3">
                      <span className="text-xl">🧍</span>
                      <div>
                        <h4 className="font-medium text-sm">4. Neutral Pose</h4>
                        <ul className="text-xs text-zenna-muted mt-1 space-y-1">
                          <li>• Face the camera</li>
                          <li>• Keep shoulders relaxed</li>
                          <li>• No extreme expressions</li>
                          <li>• No glasses, hats, or obstructions (unless you want them on the avatar)</li>
                        </ul>
                      </div>
                    </div>

                    {/* Consistent Appearance */}
                    <div className="flex gap-3">
                      <span className="text-xl">🎨</span>
                      <div>
                        <h4 className="font-medium text-sm">5. Consistent Appearance</h4>
                        <p className="text-xs text-zenna-muted mt-1">If uploading multiple images:</p>
                        <ul className="text-xs text-zenna-muted mt-1 space-y-1">
                          <li>• Same hairstyle</li>
                          <li>• Same lighting</li>
                          <li>• Same camera distance</li>
                          <li>• Same clothing (if you want clothing reconstructed)</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Open-Source Tools Section */}
                <div className="mt-6 pt-6 border-t border-zenna-border/50">
                  <h4 className="font-medium text-sm mb-3 flex items-center gap-2">
                    <span>🛠️</span>
                    Open-Source Consumer Tools for Creating 3D-Ready Images
                  </h4>
                  <div className="grid md:grid-cols-2 gap-4 text-xs">
                    <div className="bg-zenna-surface/50 rounded-lg p-3">
                      <h5 className="font-medium text-green-400 mb-1">🟢 Meshroom (Open-Source Photogrammetry)</h5>
                      <ul className="text-zenna-muted space-y-1">
                        <li>• Free, open-source</li>
                        <li>• Converts multiple photos into a 3D mesh</li>
                        <li>• Works best with 20–40 photos around the subject</li>
                        <li>• Produces OBJ/PLY that can be cleaned in Blender</li>
                      </ul>
                    </div>
                    <div className="bg-zenna-surface/50 rounded-lg p-3">
                      <h5 className="font-medium text-green-400 mb-1">🟢 Blender (Open-Source 3D Suite)</h5>
                      <ul className="text-zenna-muted space-y-1">
                        <li>• Clean up meshes</li>
                        <li>• Add rigging</li>
                        <li>• Export GLB for Babylon.js or Three.js</li>
                        <li>• Add blendshapes for facial animation</li>
                      </ul>
                    </div>
                    <div className="bg-zenna-surface/50 rounded-lg p-3">
                      <h5 className="font-medium text-green-400 mb-1">🟢 PIFuHD / PIFuXR (Open-Source 2D-to-3D)</h5>
                      <ul className="text-zenna-muted space-y-1">
                        <li>• Generates a 3D human model from a single image</li>
                        <li>• Great fallback when users only upload one photo</li>
                        <li>• Works well for stylized avatars</li>
                      </ul>
                    </div>
                    <div className="bg-zenna-surface/50 rounded-lg p-3">
                      <h5 className="font-medium text-green-400 mb-1">🟢 OpenMVG + OpenMVS</h5>
                      <ul className="text-zenna-muted space-y-1">
                        <li>• Full photogrammetry pipeline</li>
                        <li>• More control than Meshroom</li>
                        <li>• Produces high-quality meshes</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>

              {/* Upload Area */}
              <div className="border-2 border-dashed border-zenna-border rounded-lg p-6 text-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  onChange={(e) => handleFileSelect(e.target.files)}
                  className="hidden"
                />

                <div className="space-y-4">
                  <div className="w-16 h-16 mx-auto bg-zenna-surface rounded-full flex items-center justify-center">
                    <svg className="w-8 h-8 text-zenna-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>

                  <div>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading}
                      className="btn-primary"
                    >
                      {isUploading ? 'Uploading...' : 'Upload Reference Images'}
                    </button>
                    <p className="text-xs text-zenna-muted mt-2">
                      PNG, JPEG, or WebP • Max 10MB per image • Multiple images recommended
                    </p>
                  </div>
                </div>

                {uploadError && (
                  <p className="text-red-400 text-sm mt-4">{uploadError}</p>
                )}
              </div>

              {/* Generation Limits Banner */}
              {!isLoadingLimits && generationLimits && (
                <div className={`rounded-lg p-4 ${
                  generationLimits.isUnlimited
                    ? 'bg-green-500/10 border border-green-500/30'
                    : generationLimits.remaining === 0
                    ? 'bg-red-500/10 border border-red-500/30'
                    : 'bg-blue-500/10 border border-blue-500/30'
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">
                        {generationLimits.isUnlimited ? '♾️' : generationLimits.remaining === 0 ? '🚫' : '🎯'}
                      </span>
                      <div>
                        <p className="font-medium text-sm">
                          {generationLimits.isUnlimited
                            ? 'Unlimited Generations'
                            : `${generationLimits.remaining} of ${generationLimits.limit} generations remaining`}
                        </p>
                        <p className="text-xs text-zenna-muted">
                          {generationLimits.isUnlimited
                            ? 'Admin accounts have unlimited avatar generations'
                            : `Resets ${new Date(generationLimits.resetsAt).toLocaleDateString()}`}
                        </p>
                      </div>
                    </div>
                    {!generationLimits.isUnlimited && (
                      <div className="flex gap-1">
                        {[...Array(generationLimits.limit)].map((_, i) => (
                          <div
                            key={i}
                            className={`w-3 h-3 rounded-full ${
                              i < generationLimits.used ? 'bg-zenna-muted' : 'bg-zenna-accent'
                            }`}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Uploaded Images */}
              {uploadedImages.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium mb-3">Uploaded Images ({uploadedImages.length})</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {uploadedImages.map((img, index) => (
                      <div key={index} className="relative group">
                        <img
                          src={img.preview}
                          alt={`Reference ${index + 1}`}
                          className="w-full aspect-square object-cover rounded-lg border border-zenna-border"
                        />

                        {/* Validation badges */}
                        <div className="absolute top-2 left-2 flex flex-col gap-1">
                          {img.validation.warnings.length > 0 && (
                            <span className="bg-yellow-500/80 text-black text-xs px-2 py-0.5 rounded">
                              ⚠️
                            </span>
                          )}
                          {img.validation.hasTransparency && (
                            <span className="bg-green-500/80 text-white text-xs px-2 py-0.5 rounded">
                              ✓ Transparent
                            </span>
                          )}
                        </div>

                        {/* Remove button */}
                        <button
                          onClick={() => handleRemoveImage(index)}
                          className="absolute top-2 right-2 w-6 h-6 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          ×
                        </button>

                        {/* Angle selector */}
                        <select
                          value={img.angle}
                          onChange={(e) => handleAngleChange(index, e.target.value as UploadedImage['angle'])}
                          className="absolute bottom-2 left-2 right-2 bg-black/80 text-white text-xs p-1 rounded"
                        >
                          <option value="front">Front</option>
                          <option value="three-quarter">¾ View</option>
                          <option value="side">Side</option>
                          <option value="back">Back</option>
                          <option value="detail">Detail</option>
                        </select>

                        {/* Resolution info */}
                        <div className="absolute bottom-12 left-2 text-xs text-white/70 bg-black/50 px-1 rounded">
                          {img.validation.width}×{img.validation.height}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Quality Preset Selector */}
                  <div className="mt-6">
                    <h4 className="text-sm font-medium mb-3">Generation Quality</h4>
                    <div className="grid grid-cols-3 gap-3">
                      {QUALITY_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          onClick={() => setSelectedQuality(preset.id)}
                          className={`p-4 rounded-lg border-2 transition-all text-center ${
                            selectedQuality === preset.id
                              ? 'border-zenna-accent bg-zenna-accent/10'
                              : 'border-zenna-border hover:border-zenna-accent/50'
                          }`}
                        >
                          <span className="text-2xl block mb-1">{preset.icon}</span>
                          <p className="text-sm font-medium">{preset.name}</p>
                          <p className="text-xs text-zenna-muted">{preset.description}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Start Reconstruction Button */}
                  <div className="mt-6 flex justify-center">
                    <button
                      onClick={startReconstruction}
                      disabled={
                        isStartingReconstruction ||
                        uploadedImages.length === 0 ||
                        Boolean(generationLimits && !generationLimits.allowed && !generationLimits.isUnlimited)
                      }
                      className="btn-primary px-8"
                    >
                      {isStartingReconstruction ? (
                        <>
                          <span className="spinner-sm mr-2" />
                          Starting...
                        </>
                      ) : generationLimits && !generationLimits.allowed && !generationLimits.isUnlimited ? (
                        '🚫 Generation Limit Reached'
                      ) : uploadedImages.length === 1 ? (
                        '🧠 Generate Avatar (Single Image AI)'
                      ) : (
                        `🔄 Generate Avatar (${uploadedImages.length} Images)`
                      )}
                    </button>
                  </div>

                  <p className="text-center text-xs text-zenna-muted mt-2">
                    {selectedQuality === 'fast'
                      ? 'Quick preview - perfect for testing'
                      : selectedQuality === 'quality'
                      ? 'Highest detail textures and mesh resolution'
                      : 'Optimized balance of speed and quality'}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* EDITOR TAB */}
          {activeTab === 'editor' && reconstructionJob?.status === 'complete' && reconstructionJob.outputModelUrl && (
            <div className="space-y-6">
              {/* Editor Header */}
              <div className="text-center">
                <div className="w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-purple-500/20 to-pink-500/20 rounded-2xl flex items-center justify-center">
                  <span className="text-4xl">🎨</span>
                </div>
                <h3 className="text-lg font-semibold mb-2">Avatar Editor</h3>
                <p className="text-sm text-zenna-muted max-w-md mx-auto">
                  Fine-tune your avatar with professional 3D editing tools.
                  Adjust proportions, smooth surfaces, or add custom details.
                </p>
              </div>

              {/* Editor Options */}
              <div className="grid gap-4 max-w-lg mx-auto">
                {/* Download for External Editing */}
                <div className="glass-card p-4">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-blue-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
                      <span className="text-2xl">💾</span>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium mb-1">Download 3D Model</h4>
                      <p className="text-xs text-zenna-muted mb-3">
                        Download your avatar as a GLB file to edit in your preferred 3D software.
                      </p>
                      <a
                        href={reconstructionJob.outputModelUrl}
                        download={`zenna-avatar-${reconstructionJob.id}.glb`}
                        className="btn-secondary text-sm inline-flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download GLB
                      </a>
                    </div>
                  </div>
                </div>

                {/* Open in Web Editor */}
                <div className="glass-card p-4">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-purple-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
                      <span className="text-2xl">🌐</span>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium mb-1">Open in 3D Viewer</h4>
                      <p className="text-xs text-zenna-muted mb-3">
                        Preview and inspect your avatar in an interactive 3D viewer.
                      </p>
                      <button
                        onClick={() => {
                          // Open in a 3D viewer like model-viewer or gltf-viewer
                          const viewerUrl = `https://gltf-viewer.donmccurdy.com/#model=${encodeURIComponent(reconstructionJob.outputModelUrl!)}`;
                          window.open(viewerUrl, '_blank');
                        }}
                        className="btn-secondary text-sm inline-flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                        Open Viewer
                      </button>
                    </div>
                  </div>
                </div>

                {/* Professional Editing Guide */}
                <div className="glass-card p-4 bg-gradient-to-br from-amber-500/5 to-orange-500/5">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-amber-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
                      <span className="text-2xl">📚</span>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium mb-1">Professional Editing</h4>
                      <p className="text-xs text-zenna-muted mb-3">
                        For advanced modifications like rigging, animations, or texture painting,
                        we recommend using professional 3D software.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <a
                          href="https://www.blender.org/download/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-zenna-accent hover:underline"
                        >
                          Blender (Free)
                        </a>
                        <span className="text-xs text-zenna-muted">•</span>
                        <a
                          href="https://www.autodesk.com/products/maya"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-zenna-accent hover:underline"
                        >
                          Maya
                        </a>
                        <span className="text-xs text-zenna-muted">•</span>
                        <a
                          href="https://www.maxon.net/cinema-4d"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-zenna-accent hover:underline"
                        >
                          Cinema 4D
                        </a>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Re-upload Edited Avatar */}
                <div className="glass-card p-4 border-2 border-dashed border-zenna-accent/30">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-green-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
                      <span className="text-2xl">📤</span>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium mb-1">Upload Edited Avatar</h4>
                      <p className="text-xs text-zenna-muted mb-3">
                        Made changes? Upload your edited GLB file to use as your new avatar.
                      </p>
                      <input
                        type="file"
                        accept=".glb,.gltf"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;

                          setMessage({ type: 'info', text: 'Uploading edited avatar...' });

                          try {
                            const formData = new FormData();
                            formData.append('model', file);

                            const response = await fetch('/api/settings/avatar', {
                              method: 'POST',
                              body: formData,
                            });

                            if (response.ok) {
                              const data = await response.json();
                              setMessage({ type: 'success', text: 'Edited avatar uploaded successfully!' });
                              onAvatarChange?.(data.avatarModelUrl, 'custom');
                            } else {
                              const data = await response.json();
                              setMessage({ type: 'error', text: data.error || 'Failed to upload avatar' });
                            }
                          } catch {
                            setMessage({ type: 'error', text: 'Failed to upload edited avatar' });
                          }
                        }}
                        className="hidden"
                        id="edited-avatar-upload"
                      />
                      <label
                        htmlFor="edited-avatar-upload"
                        className="btn-primary text-sm inline-flex items-center gap-2 cursor-pointer"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                        </svg>
                        Upload GLB File
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              {/* Tips */}
              <div className="bg-zenna-surface/50 rounded-lg p-4 max-w-lg mx-auto">
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <span>💡</span> Editing Tips
                </h4>
                <ul className="text-xs text-zenna-muted space-y-1">
                  <li>• Keep polygon count under 50,000 for best performance</li>
                  <li>• Preserve UV mapping when editing textures</li>
                  <li>• Export as GLB format with embedded textures</li>
                  <li>• Test animations in the 3D viewer before uploading</li>
                </ul>
              </div>
            </div>
          )}

          {/* RECONSTRUCTION TAB */}
          {activeTab === 'reconstruction' && reconstructionJob && (
            <div className="space-y-6">
              <div className="text-center py-8">
                {/* Status Icon */}
                <div className="w-24 h-24 mx-auto mb-6 relative">
                  {reconstructionJob.status === 'complete' ? (
                    <div className="w-full h-full bg-green-500/20 rounded-full flex items-center justify-center">
                      <svg className="w-12 h-12 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  ) : reconstructionJob.status === 'failed' ? (
                    <div className="w-full h-full bg-red-500/20 rounded-full flex items-center justify-center">
                      <svg className="w-12 h-12 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </div>
                  ) : (
                    <div className="w-full h-full relative">
                      <svg className="w-full h-full animate-spin" viewBox="0 0 100 100">
                        <circle
                          cx="50"
                          cy="50"
                          r="45"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="8"
                          className="text-zenna-surface"
                        />
                        <circle
                          cx="50"
                          cy="50"
                          r="45"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="8"
                          strokeDasharray={`${reconstructionJob.progress * 2.83} 283`}
                          strokeLinecap="round"
                          className="text-zenna-accent"
                          transform="rotate(-90 50 50)"
                        />
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center text-lg font-bold">
                        {reconstructionJob.progress}%
                      </span>
                    </div>
                  )}
                </div>

                {/* Status Text */}
                <h3 className="text-lg font-medium mb-2">
                  {reconstructionJob.status === 'complete'
                    ? 'Avatar Ready!'
                    : reconstructionJob.status === 'failed'
                    ? 'Reconstruction Failed'
                    : 'Generating Your Avatar...'}
                </h3>

                <p className="text-sm text-zenna-muted mb-4">
                  {getStatusMessage(reconstructionJob.status)}
                </p>

                {/* Progress Steps */}
                <div className="max-w-md mx-auto">
                  <div className="flex justify-between text-xs text-zenna-muted mb-2">
                    {['Validating', 'Processing', 'Rigging', 'Blendshapes', 'Complete'].map((step, index) => (
                      <span
                        key={step}
                        className={
                          getStepIndex(reconstructionJob.status) >= index
                            ? 'text-zenna-accent'
                            : ''
                        }
                      >
                        {step}
                      </span>
                    ))}
                  </div>
                  <div className="h-2 bg-zenna-surface rounded-full overflow-hidden">
                    <div
                      className="h-full bg-zenna-accent transition-all duration-500"
                      style={{ width: `${reconstructionJob.progress}%` }}
                    />
                  </div>
                </div>

                {/* Error message */}
                {reconstructionJob.status === 'failed' && reconstructionJob.error && (
                  <div className="mt-6 bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                    <p className="text-red-400 text-sm">{reconstructionJob.error}</p>
                    <button
                      onClick={() => {
                        setReconstructionJob(null);
                        setActiveTab('upload');
                      }}
                      className="btn-secondary mt-4"
                    >
                      Try Again
                    </button>
                  </div>
                )}

                {/* Success actions */}
                {reconstructionJob.status === 'complete' && (
                  <div className="mt-6 space-y-4">
                    {reconstructionJob.outputThumbnailUrl && (
                      <img
                        src={reconstructionJob.outputThumbnailUrl}
                        alt="Generated Avatar"
                        className="w-32 h-32 mx-auto rounded-lg border border-zenna-accent"
                      />
                    )}
                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                      <button
                        onClick={onClose}
                        className="btn-primary"
                      >
                        Use This Avatar
                      </button>
                      <button
                        onClick={() => setActiveTab('editor')}
                        className="btn-secondary flex items-center justify-center gap-2"
                      >
                        <span>✏️</span>
                        Refine in Editor
                      </button>
                    </div>
                    <p className="text-xs text-zenna-muted text-center">
                      Not satisfied? Use the Editor to adjust and perfect your avatar.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function getStatusMessage(status: ReconstructionStatus): string {
  switch (status) {
    case 'pending':
      return 'Preparing to start reconstruction...';
    case 'validating':
      return 'Validating your images...';
    case 'processing':
      return 'Creating 3D mesh from your images...';
    case 'rigging':
      return 'Adding skeleton and controls...';
    case 'blendshapes':
      return 'Creating facial expressions and lip-sync shapes...';
    case 'complete':
      return 'Your avatar is ready to use!';
    case 'failed':
      return 'Something went wrong during reconstruction.';
    default:
      return 'Processing...';
  }
}

function getStepIndex(status: ReconstructionStatus): number {
  const steps = ['pending', 'validating', 'processing', 'rigging', 'blendshapes', 'complete'];
  return steps.indexOf(status);
}
