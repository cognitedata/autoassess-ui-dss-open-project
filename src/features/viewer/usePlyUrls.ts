import { useQuery } from '@tanstack/react-query';
import { useCogniteSdk } from '@cognite/app-sdk/react';
import type { UseQueryResult } from '@tanstack/react-query';

export function usePlyUrls(fileIds: number[]): UseQueryResult<string[], Error> {
  const sdk = useCogniteSdk();
  return useQuery({
    queryKey: ['ply-urls', ...fileIds],
    queryFn: async () => {
      if (fileIds.length === 0) return [];
      const urls = await sdk.files.getDownloadUrls(fileIds.map((id) => ({ id })));
      // Match responses back to requests by id rather than array position: CDF's
      // downloadlink response is not guaranteed to preserve request order, and can come
      // back shorter than the request (e.g. a duplicate id elsewhere in the batch). Matching
      // positionally would silently misalign every file after such a gap.
      const urlById = new Map<number, string>();
      for (const u of urls as Array<{ id?: number; downloadUrl?: string }>) {
        if (u.id !== undefined && u.downloadUrl) urlById.set(u.id, u.downloadUrl);
      }
      return fileIds.map((id) => {
        const url = urlById.get(id);
        if (!url) throw new Error(`No download URL for file ${id}`);
        return url;
      });
    },
    enabled: fileIds.length > 0,
    // Presigned URLs typically expire after 1 hour; refresh at 50 min
    staleTime: 50 * 60 * 1000,
  });
}
