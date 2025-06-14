import { query, transaction } from '../utils/database';
import { validateBookingData } from '../utils/validation';
import { ExtendedRequest, ExtendedResponse } from '../types';

// Explizite Database Types
interface DatabaseBusiness {
  id: number;
  type: string;
  require_phone: boolean;
  cancellation_hours: number;
}

interface DatabaseService {
  id: number;
  duration_minutes: number;
  price: string | null;
  requires_staff: boolean;
  capacity: number;
}

interface DatabaseBooking {
  id: number;
  customer_name: string;
  customer_email: string;
  booking_date: string;
  start_time: string;
  end_time: string;
  party_size: number;
  status: string;
  total_amount: string | null;
  service_name: string;
  duration_minutes: number;
  staff_name: string | null;
}

interface DatabaseBusinessName {
  name: string;
}

interface DatabaseServiceName {
  name: string;
}

interface DatabaseStaffName {
  name: string;
}

export async function handleCreateBooking(req: ExtendedRequest, res: ExtendedResponse): Promise<void> {
  const bookingData = req.body;
  
  // Manual validation (no express-validator)
  const validationErrors = validateBookingData(bookingData);
  if (validationErrors.length > 0) {
    res.status(400).json({ errors: validationErrors });
    return;
  }
  
  try {
    // Manual business validation
    const businessResult = await query(
      'SELECT id, type, require_phone, cancellation_hours FROM businesses WHERE id = $1 AND is_active = true',
      [bookingData.businessId]
    );
    
    if (businessResult.rows.length === 0) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }
    
    const business: DatabaseBusiness = businessResult.rows[0];
    
    // Manual phone requirement check
    if (business.require_phone && !bookingData.customerPhone) {
      res.status(400).json({ error: 'Phone number required for this business' });
      return;
    }
    
    // Manual service validation  
    const serviceResult = await query(
      'SELECT id, duration_minutes, price, requires_staff, capacity FROM services WHERE id = $1 AND business_id = $2 AND is_active = true',
      [bookingData.serviceId, bookingData.businessId]
    );
    
    if (serviceResult.rows.length === 0) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }
    
    const service: DatabaseService = serviceResult.rows[0];
    
    // Manual staff validation
    if (service.requires_staff && !bookingData.staffMemberId) {
      res.status(400).json({ error: 'Staff member required for this service' });
      return;
    }
    
    if (bookingData.staffMemberId) {
      const staffResult = await query(
        `SELECT sm.id FROM staff_members sm
         JOIN staff_services ss ON sm.id = ss.staff_member_id
         WHERE sm.id = $1 AND sm.business_id = $2 AND ss.service_id = $3 AND sm.is_active = true`,
        [bookingData.staffMemberId, bookingData.businessId, bookingData.serviceId]
      );
      
      if (staffResult.rows.length === 0) {
        res.status(400).json({ error: 'Invalid staff member for this service' });
        return;
      }
    }
    
    // Manual end time calculation
    const startTime = bookingData.startTime;
    const [hours, minutes] = startTime.split(':').map(Number);
    const startMinutes = hours * 60 + minutes;
    const endMinutes = startMinutes + service.duration_minutes;
    const endHours = Math.floor(endMinutes / 60);
    const endMins = endMinutes % 60;
    const endTime = `${endHours.toString().padStart(2, '0')}:${endMins.toString().padStart(2, '0')}`;
    
    // Manual total amount calculation
    let totalAmount = null;
    if (service.price) {
      totalAmount = parseFloat(service.price) * (bookingData.partySize || 1);
    }
    
    // Manual booking creation using transaction
    const bookingResult = await transaction(async (client) => {
      const insertResult = await client.query(
        `INSERT INTO bookings (
          business_id, service_id, staff_member_id, customer_name, customer_email, 
          customer_phone, booking_date, start_time, end_time, party_size, 
          special_requests, total_amount, status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending', NOW(), NOW())
        RETURNING id, customer_name, booking_date, start_time, end_time, status, total_amount`,
        [
          bookingData.businessId,
          bookingData.serviceId,
          bookingData.staffMemberId || null,
          bookingData.customerName,
          bookingData.customerEmail,
          bookingData.customerPhone || null,
          bookingData.bookingDate,
          startTime,
          endTime,
          bookingData.partySize || 1,
          bookingData.specialRequests || null,
          totalAmount
        ]
      );
      
      return insertResult.rows[0];
    });
    
    // Manual related data fetching for response
    const businessNameResult = await query('SELECT name FROM businesses WHERE id = $1', [bookingData.businessId]);
    const serviceNameResult = await query('SELECT name FROM services WHERE id = $1', [bookingData.serviceId]);
    
    const businessName: DatabaseBusinessName = businessNameResult.rows[0];
    const serviceName: DatabaseServiceName = serviceNameResult.rows[0];
    
    let staffName: string | null = null;
    if (bookingData.staffMemberId) {
      const staffResult = await query('SELECT name FROM staff_members WHERE id = $1', [bookingData.staffMemberId]);
      if (staffResult.rows.length > 0) {
        const staff: DatabaseStaffName = staffResult.rows[0];
        staffName = staff.name;
      }
    }
    
    // Manual response construction
    const response = {
      message: 'Booking created successfully',
      booking: {
        id: bookingResult.id,
        customerName: bookingResult.customer_name,
        date: bookingResult.booking_date,
        startTime: bookingResult.start_time,
        endTime: bookingResult.end_time,
        status: bookingResult.status,
        business: businessName.name,
        service: serviceName.name,
        staffMember: staffName,
        totalAmount: bookingResult.total_amount ? parseFloat(bookingResult.total_amount).toString() : null
      }
    };
    
    res.status(201).json(response);
    
  } catch (error) {
    console.error('Create booking error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleGetBookings(req: ExtendedRequest, res: ExtendedResponse): Promise<void> {
  const { businessId } = req.params!;
  const { date, status, staffMemberId } = req.query!;
  
  if (!businessId || !Number.isInteger(parseInt(businessId))) {
    res.status(400).json({ error: 'Valid business ID required' });
    return;
  }
  
  try {
    // Manual WHERE clause building
    let whereConditions = ['b.business_id = $1'];
    let queryParams: any[] = [parseInt(businessId)];
    let paramIndex = 2;
    
    if (date) {
      whereConditions.push(`b.booking_date = $${paramIndex}`);
      queryParams.push(date);
      paramIndex++;
    }
    
    if (status) {
      whereConditions.push(`b.status = $${paramIndex}`);
      queryParams.push(status);
      paramIndex++;
    }
    
    if (staffMemberId) {
      whereConditions.push(`b.staff_member_id = $${paramIndex}`);
      queryParams.push(parseInt(staffMemberId));
      paramIndex++;
    }
    
    // Manual complex JOIN query
    const bookingsQuery = `
      SELECT 
        b.id, b.customer_name, b.customer_email, b.booking_date, 
        b.start_time, b.end_time, b.party_size, b.status, b.total_amount,
        s.name as service_name, s.duration_minutes,
        sm.name as staff_name
      FROM bookings b
      JOIN services s ON b.service_id = s.id
      LEFT JOIN staff_members sm ON b.staff_member_id = sm.id
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY b.booking_date ASC, b.start_time ASC
    `;
    
    const result = await query(bookingsQuery, queryParams);
    
    // Manual data transformation mit expliziten Typen
    const bookings = result.rows.map((booking: DatabaseBooking) => ({
      id: booking.id,
      customerName: booking.customer_name,
      customerEmail: booking.customer_email,
      bookingDate: booking.booking_date,
      startTime: booking.start_time,
      endTime: booking.end_time,
      partySize: booking.party_size,
      status: booking.status,
      totalAmount: booking.total_amount ? parseFloat(booking.total_amount) : null,
      service: {
        name: booking.service_name,
        durationMinutes: booking.duration_minutes
      },
      staffMember: booking.staff_name ? {
        name: booking.staff_name
      } : null
    }));
    
    res.status(200).json({ bookings });
    
  } catch (error) {
    console.error('Get bookings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}