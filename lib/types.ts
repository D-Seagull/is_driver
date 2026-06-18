import { TripStatus } from '@/constants/trip-status';

export type StopType = 'LOADING' | 'UNLOADING';
export type TruckStatus = 'AVAILABLE' | 'ON_TRIP' | 'REPAIR';

export interface TruckNote {
  id: string;
  truckId: string;
  userId: string;
  content: string;
  createdAt: string;
  user: { id: string; firstName: string; lastName: string | null; role: string };
}

export interface DriverTruck {
  id: string;
  plate: string;
  status: TruckStatus;
  isActive: boolean;
  manager: {
    id: string;
    firstName: string;
    lastName: string | null;
    phone: string | null;
    avatar: string | null;
    status?: 'ONLINE' | 'BUSY' | 'SLEEP';
    statusUntil?: string | null;
  } | null;
  truckNotes: TruckNote[];
}

export interface TripStop {
  id: string;
  tripId: string;
  type: StopType;
  order: number;
  address: string | null;
  ref: string | null;
  coords: string | null;
}

export interface TripDocument {
  id: string;
  tripId: string;
  fileName: string;
  fileUrl: string;
  fileType: 'PHOTO' | 'DOCUMENT';
  uploadedBy: string;
  createdAt: string;
}

export interface Trip {
  id: string;
  title: string;
  status: TripStatus;
  notes: string | null;
  orderNumber: string | null;
  createdAt: string;
  updatedAt: string;
  driver: { id: string; firstName: string; lastName: string | null; phone: string | null };
  truck: { id: string; plate: string };
  manager: { id: string; firstName: string; lastName: string | null };
  stops: TripStop[];
  documents: TripDocument[];
}
