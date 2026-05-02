import { api } from './api';

export interface DriverDocument {
  id: string;
  tripId: string;
  fileName: string;
  fileUrl: string;
  fileType: 'PHOTO' | 'DOCUMENT';
  uploadedBy: string;
  createdAt: string;
  signedUrl: string;
  uploader?: { id: string; name: string | null; role: string };
  trip?: { id: string; title: string; orderNumber: string | null };
}

export async function fetchTripDocuments(tripId: string): Promise<DriverDocument[]> {
  const { data } = await api.get<DriverDocument[]>(`/documents/trip/${tripId}`);
  return data;
}

export async function fetchTruckDocuments(truckId: string): Promise<DriverDocument[]> {
  const { data } = await api.get<DriverDocument[]>(`/documents/truck/${truckId}`);
  return data;
}

export async function fetchDocumentDownloadUrl(id: string): Promise<string> {
  const { data } = await api.get<{ url: string }>(`/documents/${id}/download`);
  return data.url;
}

export async function deleteDocument(id: string): Promise<void> {
  await api.delete(`/documents/${id}`);
}

export interface UploadFileLocal {
  uri: string;
  name: string;
  mimeType: string;
}

export async function uploadDocuments(
  tripId: string,
  files: UploadFileLocal[],
): Promise<DriverDocument[]> {
  const fd = new FormData();
  fd.append('tripId', tripId);
  for (const f of files) {
    // React Native FormData accepts { uri, name, type } shape.
    fd.append('files', {
      uri: f.uri,
      name: f.name,
      type: f.mimeType,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  }
  const { data } = await api.post<DriverDocument[]>('/documents/upload-many', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60_000,
  });
  return data;
}
