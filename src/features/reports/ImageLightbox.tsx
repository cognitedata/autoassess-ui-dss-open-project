import { useEffect } from 'react';
import type { DroneImage } from '../viewer/DroneImageService';
import { useDroneImageDownloadUrl } from '../viewer/useDroneImages';

function formatImageTimestamp(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const datePart = d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const timePart = d.toLocaleString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    hour12: false,
  });
  return `${datePart} · ${timePart} UTC`;
}

export function ImageLightbox({
  image,
  onClose,
  onPrev,
  onNext,
  onViewIn3D,
}: {
  image: DroneImage;
  onClose: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onViewIn3D?: () => void;
}) {
  const { data: url, isLoading } = useDroneImageDownloadUrl(image.cdfFileId);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && onPrev) onPrev();
      if (e.key === 'ArrowRight' && onNext) onNext();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, onPrev, onNext]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
    >
      <div
        className="relative flex max-h-[90vh] max-w-[90vw] flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-10 right-0 text-white/80 hover:text-white"
          aria-label="Close"
        >
          ✕
        </button>

        {/* Image area */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onPrev ?? undefined}
            disabled={onPrev === null}
            className="rounded-full bg-white/10 px-3 py-2 text-white hover:bg-white/20 disabled:opacity-30"
            aria-label="Previous image"
          >
            ‹
          </button>

          <div className="flex max-h-[80vh] items-center justify-center">
            {isLoading && (
              <div className="h-64 w-96 animate-pulse rounded-lg bg-white/10" />
            )}
            {url && (
              <img
                src={url}
                alt={`Frame ${image.frameId}`}
                className="max-h-[80vh] max-w-full rounded-lg object-contain"
              />
            )}
          </div>

          <button
            type="button"
            onClick={onNext ?? undefined}
            disabled={onNext === null}
            className="rounded-full bg-white/10 px-3 py-2 text-white hover:bg-white/20 disabled:opacity-30"
            aria-label="Next image"
          >
            ›
          </button>
        </div>

        {/* Caption */}
        <div className="text-center text-sm text-white/80">
          <p>{formatImageTimestamp(image.timestamp)}</p>
          <p className="text-xs text-white/50">Frame {image.frameId}</p>
          {onViewIn3D && (
            <button
              type="button"
              onClick={onViewIn3D}
              className="mt-1 text-xs text-white/70 underline hover:text-white"
            >
              View in 3D viewer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
