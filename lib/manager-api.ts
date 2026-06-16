import { api } from './api';

export interface ManagerProfile {
  id: string;
  firstName: string; lastName: string | null;
  email: string | null;
  phone: string | null;
  avatar: string | null;
  role: string;
  isActive: boolean;
  managerAverageRating: number | null;
  managerRatingCount: number;
}

export interface ManagerRating {
  id: string;
  score: number;
  comment: string | null;
  anonymous: boolean;
  createdAt: string;
  ratedBy: { id: string; firstName: string; lastName: string | null; role: string };
}

export interface ManagerRatingsResponse {
  ratings: ManagerRating[];
  averageRating: number | null;
  ratingCount: number;
}

export async function fetchManagerProfile(
  managerId: string,
): Promise<ManagerProfile> {
  const { data } = await api.get<ManagerProfile>(`/users/${managerId}`);
  return data;
}

export async function fetchManagerRatings(
  managerId: string,
): Promise<ManagerRatingsResponse> {
  const { data } = await api.get<ManagerRatingsResponse>(
    `/users/${managerId}/manager-ratings`,
  );
  return data;
}

export async function rateManager(
  managerId: string,
  payload: { score: number; comment?: string; anonymous?: boolean },
): Promise<ManagerRating> {
  const { data } = await api.post<ManagerRating>(
    `/users/${managerId}/manager-ratings`,
    payload,
  );
  return data;
}
