export interface ValidationError {
    field: string;
    message: string;
  }
  
  export function validateEmail(email: string): ValidationError | null {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { field: 'email', message: 'Invalid email format' };
    }
    return null;
  }
  
  export function validateRequired(value: any, fieldName: string): ValidationError | null {
    if (!value || (typeof value === 'string' && value.trim() === '')) {
      return { field: fieldName, message: `${fieldName} is required` };
    }
    return null;
  }
  
  export function validateLength(value: string, min: number, max: number, fieldName: string): ValidationError | null {
    if (value.length < min || value.length > max) {
      return { field: fieldName, message: `${fieldName} must be between ${min} and ${max} characters` };
    }
    return null;
  }
  
  export function validatePhone(phone: string): ValidationError | null {
    const phoneRegex = /^\+\d{1,3}\s?\d{1,14}$/;
    if (phone && !phoneRegex.test(phone)) {
      return { field: 'phone', message: 'Invalid phone format' };
    }
    return null;
  }
  
  export function validateBookingData(data: any): ValidationError[] {
    const errors: ValidationError[] = [];
    
    // Required fields
    const requiredError = validateRequired(data.customerName, 'customerName');
    if (requiredError) errors.push(requiredError);
    
    const emailError = validateRequired(data.customerEmail, 'customerEmail');
    if (emailError) errors.push(emailError);
    
    // Email format
    if (data.customerEmail) {
      const emailFormatError = validateEmail(data.customerEmail);
      if (emailFormatError) errors.push(emailFormatError);
    }
    
    // Phone format (optional)
    if (data.customerPhone) {
      const phoneError = validatePhone(data.customerPhone);
      if (phoneError) errors.push(phoneError);
    }
    
    // Business logic validation
    if (!data.businessId || !Number.isInteger(data.businessId)) {
      errors.push({ field: 'businessId', message: 'Valid business ID required' });
    }
    
    if (!data.serviceId || !Number.isInteger(data.serviceId)) {
      errors.push({ field: 'serviceId', message: 'Valid service ID required' });
    }
    
    return errors;
  }