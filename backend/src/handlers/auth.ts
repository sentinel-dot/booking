import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../utils/database';
import { validateEmail, validateRequired, validateLength, ValidationError } from '../utils/validation';
import { ExtendedRequest, ExtendedResponse } from '../types';

// Explizite Database User Type
interface DatabaseUser {
  id: number;
  email: string;
  password_hash: string; // Snake_case aus PostgreSQL
  first_name: string;
  last_name: string;
  role: string;
  is_active: boolean;
}

export async function handleLogin(req: ExtendedRequest, res: ExtendedResponse): Promise<void> {
  const { email, password } = req.body;
  
  // Manual validation (no express-validator)
  const errors: ValidationError[] = [];
  
  const emailRequired = validateRequired(email, 'email');
  if (emailRequired) errors.push(emailRequired);
  
  const passwordRequired = validateRequired(password, 'password');
  if (passwordRequired) errors.push(passwordRequired);
  
  if (email) {
    const emailFormat = validateEmail(email);
    if (emailFormat) errors.push(emailFormat);
  }
  
  if (errors.length > 0) {
    res.status(400).json({ errors });
    return;
  }
  
  try {
    // Raw SQL query (no Prisma ORM)
    const result = await query(
      'SELECT id, email, password_hash, first_name, last_name, role, is_active FROM users WHERE email = $1 AND is_active = true',
      [email.toLowerCase()]
    );
    
    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    
    const user: DatabaseUser = result.rows[0];
    
    // Debug logging (entfernen nach dem Fix)
    console.log('User found:', { 
      id: user.id, 
      email: user.email, 
      hasPasswordHash: !!user.password_hash,
      passwordHashLength: user.password_hash ? user.password_hash.length : 0
    });
    
    // Überprüfe ob password_hash existiert
    if (!user.password_hash) {
      console.error('No password hash found for user:', user.email);
      res.status(500).json({ error: 'User authentication data corrupted' });
      return;
    }
    
    // Manual password verification
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    
    // Update login stats manually
    await query(
      'UPDATE users SET last_login = NOW(), login_count = login_count + 1 WHERE id = $1',
      [user.id]
    );
    
    // Create JWT manually
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email 
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );
    
    // Manual response formatting (no res.json() magic)
    res.status(200).json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,  // Snake_case zu camelCase
        lastName: user.last_name,    // Snake_case zu camelCase
        role: user.role
      },
      token
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleRegister(req: ExtendedRequest, res: ExtendedResponse): Promise<void> {
  const { email, password, firstName, lastName } = req.body;
  
  // Detailed manual validation
  const errors: ValidationError[] = [];
  
  const emailRequired = validateRequired(email, 'email');
  if (emailRequired) errors.push(emailRequired);
  
  const passwordRequired = validateRequired(password, 'password');
  if (passwordRequired) errors.push(passwordRequired);
  
  const firstNameRequired = validateRequired(firstName, 'firstName');
  if (firstNameRequired) errors.push(firstNameRequired);
  
  const lastNameRequired = validateRequired(lastName, 'lastName');
  if (lastNameRequired) errors.push(lastNameRequired);
  
  if (email) {
    const emailFormat = validateEmail(email);
    if (emailFormat) errors.push(emailFormat);
  }
  
  if (password) {
    const passwordLength = validateLength(password, 6, 100, 'password');
    if (passwordLength) errors.push(passwordLength);
  }
  
  if (errors.length > 0) {
    res.status(400).json({ errors });
    return;
  }
  
  try {
    // Check if user already exists (manual SQL)
    const existingUser = await query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    
    if (existingUser.rows.length > 0) {
      res.status(400).json({ error: 'User already exists' });
      return;
    }
    
    // Hash password manually
    const passwordHash = await bcrypt.hash(password, 12);
    
    // Debug logging
    console.log('Creating user with password hash length:', passwordHash.length);
    
    // Insert new user (manual SQL)
    const newUser = await query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, is_active, email_verified, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'owner', true, false, NOW(), NOW())
       RETURNING id, email, first_name, last_name, role`,
      [email.toLowerCase(), passwordHash, firstName.trim(), lastName.trim()]
    );
    
    const user = newUser.rows[0];
    
    // Create JWT
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email 
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );
    
    res.status(201).json({
      message: 'User created successfully',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role
      },
      token
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}