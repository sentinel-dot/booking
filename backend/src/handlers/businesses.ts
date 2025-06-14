import { query } from '../utils/database';
import { ExtendedRequest, ExtendedResponse } from '../types';

// Explizite Typen für Database Results
interface DatabaseService {
  id: number;
  name: string;
  description: string | null;
  duration_minutes: number;
  price: string | null; // PostgreSQL Decimal kommt als string
  capacity: number;
  requires_staff: boolean;
}

interface DatabaseStaff {
  id: number;
  name: string;
  description: string | null;
  avatar_url: string | null;
}

interface DatabaseBusiness {
  id: number;
  name: string;
  type: string;
  description: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  website_url: string | null;
  instagram_handle: string | null;
  booking_advance_days: number;
  cancellation_hours: number;
  require_phone: boolean;
}

export async function handleGetPublicBusiness(req: ExtendedRequest, res: ExtendedResponse): Promise<void> {
  const { slug } = req.params!;
  
  if (!slug) {
    res.status(400).json({ error: 'Business slug required' });
    return;
  }
  
  try {
    // Complex manual SQL query (no Prisma relations)
    const businessQuery = `
      SELECT 
        b.id, b.name, b.type, b.description, b.address, b.city, 
        b.phone, b.website_url, b.instagram_handle, 
        b.booking_advance_days, b.cancellation_hours, b.require_phone
      FROM businesses b 
      WHERE b.booking_link_slug = $1 AND b.is_active = true
    `;
    
    const businessResult = await query(businessQuery, [slug]);
    
    if (businessResult.rows.length === 0) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    
    const business: DatabaseBusiness = businessResult.rows[0];
    
    // Manual service fetching (no include magic)
    const servicesQuery = `
      SELECT id, name, description, duration_minutes, price, capacity, requires_staff
      FROM services 
      WHERE business_id = $1 AND is_active = true
      ORDER BY name
    `;
    
    const servicesResult = await query(servicesQuery, [business.id]);
    
    // Manual staff fetching
    const staffQuery = `
      SELECT id, name, description, avatar_url
      FROM staff_members 
      WHERE business_id = $1 AND is_active = true
      ORDER BY name
    `;
    
    const staffResult = await query(staffQuery, [business.id]);
    
    // Manual data transformation mit expliziten Typen
    const responseData = {
      id: business.id,
      name: business.name,
      type: business.type,
      description: business.description,
      address: business.address,
      city: business.city,
      phone: business.phone,
      websiteUrl: business.website_url,
      instagramHandle: business.instagram_handle,
      bookingAdvanceDays: business.booking_advance_days,
      cancellationHours: business.cancellation_hours,
      requirePhone: business.require_phone,
      services: servicesResult.rows.map((service: DatabaseService) => ({
        id: service.id,
        name: service.name,
        description: service.description,
        durationMinutes: service.duration_minutes,
        price: service.price ? parseFloat(service.price) : null,
        capacity: service.capacity,
        requiresStaff: service.requires_staff
      })),
      staffMembers: staffResult.rows.map((staff: DatabaseStaff) => ({
        id: staff.id,
        name: staff.name,
        description: staff.description,
        avatarUrl: staff.avatar_url
      }))
    };
    
    res.status(200).json(responseData);
    
  } catch (error) {
    console.error('Get public business error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

interface DatabaseBusinessWithCounts {
  id: number;
  name: string;
  type: string;
  booking_link_slug: string;
  service_count: string; // COUNT() returns string
  staff_count: string;
  booking_count: string;
}

export async function handleGetBusinesses(req: ExtendedRequest, res: ExtendedResponse): Promise<void> {
  try {
    const businesses = await query(`
      SELECT 
        b.id, b.name, b.type, b.booking_link_slug,
        COUNT(DISTINCT s.id) as service_count,
        COUNT(DISTINCT sm.id) as staff_count,
        COUNT(DISTINCT bk.id) as booking_count
      FROM businesses b
      LEFT JOIN services s ON b.id = s.business_id AND s.is_active = true
      LEFT JOIN staff_members sm ON b.id = sm.business_id AND sm.is_active = true  
      LEFT JOIN bookings bk ON b.id = bk.business_id
      WHERE b.is_active = true
      GROUP BY b.id, b.name, b.type, b.booking_link_slug
      ORDER BY b.name
    `);
    
    const responseData = businesses.rows.map((business: DatabaseBusinessWithCounts) => ({
      id: business.id,
      name: business.name,
      type: business.type,
      bookingLinkSlug: business.booking_link_slug,
      _count: {
        services: parseInt(business.service_count),
        staffMembers: parseInt(business.staff_count),
        bookings: parseInt(business.booking_count)
      }
    }));
    
    res.status(200).json(responseData);
    
  } catch (error) {
    console.error('Get businesses error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}