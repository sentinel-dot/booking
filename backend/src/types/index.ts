import { IncomingMessage, ServerResponse } from 'http';

// Extend IncomingMessage for our needs
export interface ExtendedRequest extends IncomingMessage {
  body?: any;
  user?: {
    id: number;
    email: string;
    role: string;
  };
  params?: Record<string, string>;
  query?: Record<string, string>;
}

export interface ExtendedResponse extends ServerResponse {
  json: (data: any) => void;
  status: (code: number) => ExtendedResponse;
  send: (data: string) => void;
}

export interface User {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  passwordHash: string;
}

export interface Business {
  id: number;
  name: string;
  type: string;
  email: string;
  phone?: string;
  address?: string;
  city?: string;
  bookingLinkSlug: string;
  isActive: boolean;
}

export interface Service {
  id: number;
  businessId: number;
  name: string;
  description?: string;
  durationMinutes: number;
  price?: number;
  requiresStaff: boolean;
}

export interface Booking {
  id: number;
  businessId: number;
  serviceId: number;
  staffMemberId?: number;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
}

export interface RouteHandler {
  (req: ExtendedRequest, res: ExtendedResponse): Promise<void>;
}