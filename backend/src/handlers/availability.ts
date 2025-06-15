import { query } from '../utils/database';
import { ExtendedRequest, ExtendedResponse } from '../types';

interface TimeSlot {
  start: string;
  end: string;
  staffMemberId?: number;
  available: boolean;
}

interface AvailabilityParams {
  businessId: number;
  serviceId: number;
  date: string;
  staffMemberId?: number;
}

export async function handleGetAvailability(req: ExtendedRequest, res: ExtendedResponse): Promise<void> {
  const { businessId, serviceId, date, staffMemberId } = req.query!;
  
  // Manual parameter validation (no express-validator)
  const errors: string[] = [];
  
  if (!businessId || !Number.isInteger(parseInt(businessId))) {
    errors.push('Valid businessId required');
  }
  
  if (!serviceId || !Number.isInteger(parseInt(serviceId))) {
    errors.push('Valid serviceId required');
  }
  
  if (!date || !isValidDate(date)) {
    errors.push('Valid date required (YYYY-MM-DD)');
  }
  
  if (staffMemberId && !Number.isInteger(parseInt(staffMemberId))) {
    errors.push('Valid staffMemberId required');
  }
  
  if (errors.length > 0) {
    res.status(400).json({ errors });
    return;
  }
  
  const params: AvailabilityParams = {
    businessId: parseInt(businessId),
    serviceId: parseInt(serviceId),
    date,
    staffMemberId: staffMemberId ? parseInt(staffMemberId) : undefined
  };
  
  try {
    const slots = await calculateAvailableSlots(params);
    
    res.status(200).json({
      date: params.date,
      slots
    });
    
  } catch (error) {
    console.error('Get availability error:', error);
    
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

// Manual availability calculation (was AvailabilityService in Express)
export async function calculateAvailableSlots(params: AvailabilityParams): Promise<TimeSlot[]> {
  const { businessId, serviceId, date, staffMemberId } = params;
  
  // 1. Manual business validation
  const businessResult = await query(
    'SELECT type, booking_advance_days, is_active FROM businesses WHERE id = $1',
    [businessId]
  );
  
  if (businessResult.rows.length === 0 || !businessResult.rows[0].is_active) {
    throw new Error('Business not found or inactive');
  }
  
  const business = businessResult.rows[0];
  
  // 2. Manual service validation
  const serviceResult = await query(
    `SELECT duration_minutes, capacity, requires_staff, buffer_after_minutes, is_active 
     FROM services WHERE id = $1 AND business_id = $2`,
    [serviceId, businessId]
  );
  
  if (serviceResult.rows.length === 0 || !serviceResult.rows[0].is_active) {
    throw new Error('Service not found or inactive');
  }
  
  const service = serviceResult.rows[0];
  
  // 3. Manual advance booking check
  const requestDate = new Date(date);
  const maxBookingDate = new Date();
  maxBookingDate.setDate(maxBookingDate.getDate() + business.booking_advance_days);
  
  if (requestDate > maxBookingDate) {
    return []; // Too far in future
  }
  
  // 4. Manual business type logic
  if (business.type === 'restaurant') {
    return await getRestaurantSlots(businessId, service, date);
  } else {
    return await getStaffBasedSlots(businessId, serviceId, service, date, staffMemberId);
  }
}

// Manual restaurant slots (no staff required)
async function getRestaurantSlots(businessId: number, service: any, date: string): Promise<TimeSlot[]> {
  const dayOfWeek = getDayOfWeek(date);
  
  // Manual business hours query
  const hoursResult = await query(
    `SELECT start_time, end_time FROM availability_rules 
     WHERE business_id = $1 AND staff_member_id IS NULL AND day_of_week = $2 AND is_active = true`,
    [businessId, dayOfWeek]
  );
  
  if (hoursResult.rows.length === 0) {
    return []; // Closed
  }
  
  // Manual special availability check
  const specialResult = await query(
    `SELECT is_available, start_time, end_time FROM special_availability 
     WHERE business_id = $1 AND staff_member_id IS NULL AND date = $2`,
    [businessId, date]
  );
  
  if (specialResult.rows.length > 0 && !specialResult.rows[0].is_available) {
    return []; // Closed for special reason
  }
  
  // Manual time slot generation
  const allSlots: TimeSlot[] = [];
  
  for (const hours of hoursResult.rows) {
    const startTime = specialResult.rows[0]?.start_time || hours.start_time;
    const endTime = specialResult.rows[0]?.end_time || hours.end_time;
    
    const slots = generateTimeSlots(
      startTime,
      endTime,
      service.duration_minutes,
      15 // 15min intervals
    );
    
    allSlots.push(...slots);
  }
  
  // Manual existing bookings check
  const availableSlots = await filterByRestaurantCapacity(
    allSlots,
    businessId,
    service.id,
    date,
    service.capacity
  );
  
  return availableSlots;
}

// Manual staff-based slots (salon, spa, etc.)
async function getStaffBasedSlots(
    businessId: number,
    serviceId: number,
    service: any,
    date: string,
    requestedStaffId?: number
  ): Promise<TimeSlot[]> {
    const dayOfWeek = getDayOfWeek(date);
  
    // Available staff members for this service
    let staffQuery = `
      SELECT DISTINCT sm.id, sm.name FROM staff_members sm
      JOIN staff_services ss ON sm.id = ss.staff_member_id
      WHERE sm.business_id = $1 AND ss.service_id = $2 AND sm.is_active = true
    `;
    
    let staffParams = [businessId, serviceId];
    
    if (requestedStaffId) {
      staffQuery += ' AND sm.id = $3';
      staffParams.push(requestedStaffId);
    }
    
    const staffResult = await query(staffQuery, staffParams);
    
    if (staffResult.rows.length === 0) {
      return [];
    }
  
    const allSlots: TimeSlot[] = [];
  
    for (const staff of staffResult.rows) {
      // Staff working hours
      const staffHoursResult = await query(
        `SELECT start_time, end_time FROM availability_rules 
         WHERE staff_member_id = $1 AND day_of_week = $2 AND is_active = true`,
        [staff.id, dayOfWeek]
      );
  
      if (staffHoursResult.rows.length === 0) {
        continue;
      }
  
      // Staff special availability
      const staffSpecialResult = await query(
        `SELECT is_available, start_time, end_time FROM special_availability 
         WHERE staff_member_id = $1 AND TO_CHAR(date, 'YYYY-MM-DD') = $2`,
        [staff.id, date]
      );
  
      if (staffSpecialResult.rows.length > 0 && !staffSpecialResult.rows[0].is_available) {
        continue;
      }
  
      // 🔧 NEW: Generate fixed 15-minute slots
      for (const hours of staffHoursResult.rows) {
        const startTime = staffSpecialResult.rows[0]?.start_time || hours.start_time;
        const endTime = staffSpecialResult.rows[0]?.end_time || hours.end_time;
        
        const staffSlots = generateFixedTimeSlots(startTime, endTime, 15);
  
        const staffSlotsWithId = staffSlots.map(slot => ({
          ...slot,
          staffMemberId: staff.id
        }));
  
        allSlots.push(...staffSlotsWithId);
      }
    }
  
    // 🔧 NEW: Filter by service duration and buffer
    const availableSlots = await filterByServiceDurationAndBuffer(
      allSlots,
      businessId,
      serviceId,
      date,
      service
    );
  
    return availableSlots;
  }

// NEW: Generate fixed 15-minute time slots
function generateFixedTimeSlots(
    startTime: string,
    endTime: string,
    intervalMinutes: number = 15
  ): TimeSlot[] {
    const slots: TimeSlot[] = [];
    
    const startMinutes = timeToMinutes(startTime);
    const endMinutes = timeToMinutes(endTime);
    
    let currentMinutes = startMinutes;
    
    while (currentMinutes < endMinutes) {
      const slotStart = minutesToTime(currentMinutes);
      const slotEnd = minutesToTime(currentMinutes + intervalMinutes);
      
      slots.push({
        start: slotStart,
        end: slotEnd,
        available: true
      });
  
      currentMinutes += intervalMinutes;
    }
  
    return slots;
  }
  
  // NEW: Filter slots by service duration and after-buffer only
async function filterByServiceDurationAndBuffer(
    slots: TimeSlot[],
    businessId: number,
    serviceId: number,
    date: string,
    service: any
  ): Promise<TimeSlot[]> {
    
    const bookingsResult = await query(
      `SELECT b.staff_member_id, b.start_time, b.end_time, 
              s.duration_minutes, s.buffer_after_minutes
       FROM bookings b
       JOIN services s ON b.service_id = s.id
       WHERE b.business_id = $1 AND TO_CHAR(b.booking_date, 'YYYY-MM-DD') = $2 
       AND b.status IN ('confirmed', 'pending')`,
      [businessId, date]
    );
    
    const existingBookings = bookingsResult.rows;
    
    console.log('🎯 SIMPLIFIED FILTERING:');
    console.log(`   Service: ${service.duration_minutes}min + ${service.buffer_after_minutes || 0}min cleanup`);
    console.log(`   Existing bookings: ${existingBookings.length}`);
    
    return slots.filter(slot => {
      if (!slot.staffMemberId) return false;
      
      // Calculate when THIS service would end (including after-buffer)
      const slotStartMinutes = timeToMinutes(slot.start);
      const serviceEndMinutes = slotStartMinutes + service.duration_minutes + (service.buffer_after_minutes || 0);
      const serviceEndTime = minutesToTime(serviceEndMinutes);
      
      console.log(`🔍 Slot ${slot.start} → Service would end at ${serviceEndTime}`);
      
      // Check against all existing bookings for this staff member
      for (const booking of existingBookings) {
        if (booking.staff_member_id === slot.staffMemberId) {
          
          // Existing booking blocks from start until end + its buffer
          const bookingStart = booking.start_time;
          const bookingEndMinutes = timeToMinutes(booking.end_time) + (booking.buffer_after_minutes || 0);
          const bookingEnd = minutesToTime(bookingEndMinutes);
          
          console.log(`   vs existing: ${bookingStart}-${bookingEnd}`);
          
          // Check if OUR service overlaps with existing booking (including its buffer)
          const conflict = timesOverlapExact(slot.start, serviceEndTime, bookingStart, bookingEnd);
          
          if (conflict) {
            console.log(`   ❌ BLOCKED: Service ${slot.start}-${serviceEndTime} conflicts with ${bookingStart}-${bookingEnd}`);
            return false;
          }
        }
      }
      
      console.log(`   ✅ AVAILABLE`);
      return true;
    });
  }

  // Exact overlap detection (no threshold)
function timesOverlapExact(start1: string, end1: string, start2: string, end2: string): boolean {
    const s1 = timeToMinutes(start1);
    const e1 = timeToMinutes(end1);
    const s2 = timeToMinutes(start2);
    const e2 = timeToMinutes(end2);
    
    return s1 < e2 && s2 < e1;
  }






// Manual time slot generation (no date-fns library)
function generateTimeSlots(
  startTime: string,
  endTime: string,
  durationMinutes: number,
  intervalMinutes: number = 15
): TimeSlot[] {
  const slots: TimeSlot[] = [];
  
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);
  
  let currentMinutes = startMinutes;
  
  while (currentMinutes + durationMinutes <= endMinutes) {
    const slotStart = minutesToTime(currentMinutes);
    const slotEnd = minutesToTime(currentMinutes + durationMinutes);
    
    slots.push({
      start: slotStart,
      end: slotEnd,
      available: true
    });
    
    currentMinutes += intervalMinutes;
  }
  
  return slots;
}

// Manual restaurant capacity filtering
async function filterByRestaurantCapacity(
  slots: TimeSlot[],
  businessId: number,
  serviceId: number,
  date: string,
  maxCapacity: number
): Promise<TimeSlot[]> {
  
  // Manual existing bookings query
  const bookingsResult = await query(
    `SELECT start_time, end_time, party_size FROM bookings 
     WHERE business_id = $1 AND service_id = $2 AND booking_date = $3 
     AND status IN ('confirmed', 'pending')`,
    [businessId, serviceId, date]
  );
  
  const existingBookings = bookingsResult.rows;
  
  // Manual capacity calculation for each slot
  return slots.map(slot => {
    let usedCapacity = 0;
    
    // Manual overlap check
    for (const booking of existingBookings) {
      if (timesOverlap(slot.start, slot.end, booking.start_time, booking.end_time)) {
        usedCapacity += booking.party_size;
      }
    }
    
    return {
      ...slot,
      available: usedCapacity < maxCapacity
    };
  });
}

// Manual staff booking conflicts check
async function filterByStaffBookings(
  slots: TimeSlot[],
  businessId: number,
  serviceId: number,
  date: string,
  service: any
): Promise<TimeSlot[]> {
  
  // Manual staff bookings query with service buffer times
  const bookingsResult = await query(
    `SELECT b.staff_member_id, b.start_time, b.end_time, s.buffer_after_minutes
     FROM bookings b
     JOIN services s ON b.service_id = s.id
     WHERE b.business_id = $1 AND b.booking_date = $2 
     AND b.status IN ('confirmed', 'pending')`,
    [businessId, date]
  );
  
  const existingBookings = bookingsResult.rows;
  console.log('🔍 DEBUG - Existing bookings:', existingBookings);
  
  // Manual conflict detection
  return slots.filter(slot => {
    if (!slot.staffMemberId) return false;
    
    // Manual staff booking check
    for (const booking of existingBookings) {
      if (booking.staff_member_id === slot.staffMemberId) {
        // Manual buffer time calculation
        const bookingStart = subtractMinutes(
          booking.start_time, 
          booking.buffer_before_minutes || 0
        );
        const bookingEnd = addMinutes(
          booking.end_time, 
          booking.buffer_after_minutes || 0
        );

        console.log(`🔍 BUFFER CALC:`);
        console.log(`   Original: ${booking.start_time}-${booking.end_time}`);
        console.log(`   Buffer: -${booking.buffer_before_minutes}min, +${booking.buffer_after_minutes}min`);
        console.log(`   Result: ${bookingStart}-${bookingEnd}`);
        
        console.log(`🔍 DEBUG - Checking slot ${slot.start}-${slot.end} vs booking ${bookingStart}-${bookingEnd}`);
        
        const overlaps = timesOverlap(slot.start, slot.end, bookingStart, bookingEnd);
        
        console.log(`🔍 DEBUG - Overlap result: ${overlaps}`);
        
        if (overlaps) {
          console.log(`❌ BLOCKED: Slot ${slot.start}-${slot.end} blocked by booking ${bookingStart}-${bookingEnd}`);
          return false;
        }
      }
    }
    
    return true; // No conflicts
  });
}

// Manual utility functions (no external libraries)
function timeToMinutes(timeString: string): number {
    console.log(`🔍 Converting: "${timeString}"`);
    const parts = timeString.split(':');
    console.log(`🔍 Parts:`, parts);
    const [hours, minutes] = parts.map(Number);
    console.log(`🔍 Parsed: hours=${hours}, minutes=${minutes}`);
    const result = hours * 60 + minutes;
    console.log(`🔍 Result: ${hours}*60 + ${minutes} = ${result}`);
    return result;
  }

function minutesToTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

function addMinutes(timeString: string, minutes: number): string {
  const totalMinutes = timeToMinutes(timeString) + minutes;
  return minutesToTime(totalMinutes);
}

function subtractMinutes(timeString: string, minutes: number): string {
    console.log(`🔍 subtractMinutes("${timeString}", ${minutes})`);
    const totalMinutes = timeToMinutes(timeString) - minutes;
    console.log(`🔍 totalMinutes: ${totalMinutes}`);
    const result = minutesToTime(Math.max(0, totalMinutes));
    console.log(`🔍 result: "${result}"`);
    return result;
  }

  function timesOverlap(start1: string, end1: string, start2: string, end2: string): boolean {
    const s1Minutes = timeToMinutes(start1);
    const e1Minutes = timeToMinutes(end1);
    const s2Minutes = timeToMinutes(start2);
    const e2Minutes = timeToMinutes(end2);
    
    // 🎯 REALISTISCHE LOGIC: Mindest-Overlap für Konflikt
    const MINIMUM_CONFLICT_MINUTES = 10; // Nur >10min Overlap blockieren
    
    // Calculate actual overlap duration
    const overlapStart = Math.max(s1Minutes, s2Minutes);
    const overlapEnd = Math.min(e1Minutes, e2Minutes);
    const overlapDuration = Math.max(0, overlapEnd - overlapStart);
    
    const hasSignificantOverlap = overlapDuration >= MINIMUM_CONFLICT_MINUTES;
    
    console.log(`🔍 SMART OVERLAP CHECK:`);
    console.log(`   Slot:         ${start1}-${end1} (${s1Minutes}-${e1Minutes})`);
    console.log(`   Booking+Buf:  ${start2}-${end2} (${s2Minutes}-${e2Minutes})`);
    console.log(`   Overlap:      ${overlapStart}-${overlapEnd} = ${overlapDuration} minutes`);
    console.log(`   Threshold:    ${MINIMUM_CONFLICT_MINUTES} minutes`);
    console.log(`   Conflict:     ${hasSignificantOverlap ? '❌ YES (blocked)' : '✅ NO (allowed)'}`);
    
    return hasSignificantOverlap;
  }

function getDayOfWeek(dateString: string): number {
  // Manual day of week calculation (0 = Sunday, 1 = Monday, etc.)
  const date = new Date(dateString);
  return date.getDay();
}

function isValidDate(dateString: string): boolean {
  // Manual date validation
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateString)) return false;
  
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date.getTime());
}