import { api } from './api';

export type AlarmRecurrence = 'NONE' | 'DAILY' | 'WEEKLY';

export interface Alarm {
  id: string;
  companyId: string;
  createdById: string;
  targetUserId: string;
  tripId: string | null;
  title: string;
  note: string | null;
  time: string;
  recurrence: AlarmRecurrence;
  isSent: boolean;
  createdAt: string;
  updatedAt: string;
  creator: { id: string; name: string | null; role: string };
  target: { id: string; name: string | null; role: string };
  trip: { id: string; title: string; truckId: string } | null;
}

export interface CreateAlarmPayload {
  targetUserId: string;
  title: string;
  note?: string;
  time: string;
  tripId?: string;
  recurrence?: AlarmRecurrence;
}

export async function fetchMyAlarms(): Promise<Alarm[]> {
  const res = await api.get('/alarms/my');
  return res.data;
}

export async function createAlarm(payload: CreateAlarmPayload): Promise<Alarm> {
  const res = await api.post('/alarms', payload);
  return res.data;
}

export async function deleteAlarmById(id: string): Promise<void> {
  await api.delete(`/alarms/${id}`);
}

export interface UpdateAlarmPayload {
  title?: string;
  note?: string;
  time?: string;
  recurrence?: AlarmRecurrence;
}

export async function updateAlarmById(
  id: string,
  payload: UpdateAlarmPayload,
): Promise<Alarm> {
  const res = await api.patch(`/alarms/${id}`, payload);
  return res.data;
}
