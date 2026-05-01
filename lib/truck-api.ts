import { api } from './api';
import { DriverTruck, TruckNote } from './types';

/** Returns the truck currently assigned to the logged-in driver. */
export async function fetchDriverTruck(): Promise<DriverTruck | null> {
  const { data } = await api.get<DriverTruck | null>('/trucks/driver-truck');
  return data ?? null;
}

/** Returns all notes for a truck. */
export async function fetchTruckNotes(truckId: string): Promise<TruckNote[]> {
  const { data } = await api.get<TruckNote[]>(`/trucks/${truckId}/notes`);
  return data;
}

/** Creates a note for a truck. */
export async function createTruckNote(
  truckId: string,
  content: string,
): Promise<TruckNote> {
  const { data } = await api.post<TruckNote>(`/trucks/${truckId}/notes`, {
    content,
  });
  return data;
}

/** Deletes a note (driver can only delete their own). */
export async function deleteTruckNote(noteId: string): Promise<void> {
  await api.delete(`/trucks/notes/${noteId}`);
}
