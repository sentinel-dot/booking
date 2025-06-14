import http from 'http';
import { config } from 'dotenv';
import { initDatabase } from './utils/database';
import { 
  parseBody, 
  parseRequest, 
  extendResponse, 
  setCORSHeaders, 
  matchRoute 
} from './utils/helpers';
import { ExtendedRequest, ExtendedResponse, RouteHandler } from './types';

// Import handlers
import { handleLogin, handleRegister } from './handlers/auth';
import { handleGetPublicBusiness, handleGetBusinesses } from './handlers/businesses';
import { handleCreateBooking, handleGetBookings } from './handlers/bookings';
import { handleGetAvailability } from './handlers/availability';

// Load environment variables
config();

// Initialize database
initDatabase();

// Route definitions
interface Route {
  method: string;
  pattern: string;
  handler: RouteHandler;
}

const routes: Route[] = [
  // Auth routes
  { method: 'POST', pattern: '/api/auth/login', handler: handleLogin },
  { method: 'POST', pattern: '/api/auth/register', handler: handleRegister },
  
  // Business routes
  { method: 'GET', pattern: '/api/businesses/:slug/public', handler: handleGetPublicBusiness },
  { method: 'GET', pattern: '/api/businesses', handler: handleGetBusinesses },
  
  // Booking routes
  { method: 'POST', pattern: '/api/bookings/create', handler: handleCreateBooking },
  { method: 'GET', pattern: '/api/bookings/business/:businessId', handler: handleGetBookings },
  
  // Availability routes
  { method: 'GET', pattern: '/api/availability/slots', handler: handleGetAvailability },
];

// Create HTTP server
const server = http.createServer(async (req, res) => {
  const extRes = extendResponse(res);
  
  try {
    // Set CORS headers
    setCORSHeaders(extRes);
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      extRes.status(200).end();
      return;
    }
    
    console.log(`${req.method} ${req.url}`);
    
    // Parse request
    const { pathname, query } = parseRequest(req);
    
    // Find matching route
    let matchedRoute: Route | null = null;
    let params: Record<string, string> = {};
    
    for (const route of routes) {
      if (route.method === req.method) {
        const match = matchRoute(pathname, route.pattern);
        if (match.matches) {
          matchedRoute = route;
          params = match.params;
          break;
        }
      }
    }
    
    if (!matchedRoute) {
      extRes.status(404).json({ error: 'Route not found' });
      return;
    }
    
    // Parse body for POST/PUT requests
    let body = {};
    if (['POST', 'PUT', 'PATCH'].includes(req.method || '')) {
      try {
        body = await parseBody(req);
      } catch (error) {
        extRes.status(400).json({ error: 'Invalid JSON body' });
        return;
      }
    }
    
    // Create extended request object
    const extReq = req as ExtendedRequest;
    extReq.body = body;
    extReq.params = params;
    extReq.query = query;
    
    // Call route handler
    await matchedRoute.handler(extReq, extRes);
    
  } catch (error) {
    console.error('Server error:', error);
    
    if (!extRes.headersSent) {
      extRes.status(500).json({ 
        error: 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && { 
          stack: error instanceof Error ? error.stack : 'Unknown error' 
        })
      });
    }
  }
});

// Health check endpoint
server.on('request', (req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ 
      status: 'OK', 
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    }));
  }
});

const PORT = process.env.PORT || 3002; // Different port to avoid conflicts

server.listen(PORT, () => {
  console.log(`🚀 Plain Node.js server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔗 API Base: http://localhost:${PORT}/api`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    process.exit(0);
  });
});