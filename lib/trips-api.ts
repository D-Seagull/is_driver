import { api } from './api';
import { Trip } from './types';

export async function fetchMyActiveTrip(): Promise<Trip | null> {
  const { data } = await api.get<Trip | null>('/trips/my/active');
  return data;
}

export async function fetchMyTrips(): Promise<Trip[]> {
  const { data } = await api.get<Trip[]>('/trips/my');
  return data;
}

export async function fetchTrip(id: string): Promise<Trip> {
  const { data } = await api.get<Trip>(`/trips/${id}`);
  return data;
}

export async function fetchTripMessages(id: string) {
  const { data } = await api.get(`/trips/${id}/messages`);
  return data;
}

export async function deleteTripMessage(id: string): Promise<void> {
  await api.delete(`/messages/${id}`);
}

export async function updateDriverTripStatus(id: string, status: string) {
  const { data } = await api.patch(`/trips/${id}/driver-status`, { status });
  return data;
}
