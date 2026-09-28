import { cn } from '../../lib/utils';
import type { DroneImage } from '../viewer/DroneImageService';
import { useDroneImageDownloadUrl } from '../viewer/useDroneImages';

function Thumbnail({
  image,
  onSelect,
}: {
  image: DroneImage;
  onSelect: (image: DroneImage) => void;
}) {
  const { data: url, isLoading, isError } = useDroneImageDownloadUrl(image.cdfFileId);

  return (
    <button
      type="button"
      onClick={() => onSelect(image)}
      className={cn(
        'relative aspect-video w-full overflow-hidden rounded-lg border border-border bg-muted',
        'transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
      aria-label={`Frame ${image.frameId}`}
    >
      {isLoading && (
        <div className="absolute inset-0 animate-pulse bg-muted" />
      )}
      {isError && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          Failed to load
        </div>
      )}
      {url && (
        <img
          src={url}
          alt={`Frame ${image.frameId}`}
          className="h-full w-full object-cover"
        />
      )}
    </button>
  );
}

export function CampaignImagesGrid({
  images,
  onSelect,
}: {
  images: DroneImage[];
  onSelect: (image: DroneImage) => void;
}) {
  if (images.length === 0) {
    return (
      <p className="py-4 text-sm text-muted-foreground">No images for this campaign.</p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {images.map((image) => (
        <Thumbnail key={image.externalId} image={image} onSelect={onSelect} />
      ))}
    </div>
  );
}
