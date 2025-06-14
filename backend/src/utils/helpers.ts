import { IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import { ExtendedRequest, ExtendedResponse } from '../types';

// Parse JSON body from request
export async function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    
    req.on('end', () => {
      try {
        if (body.trim() === '') {
          resolve({});
        } else {
          resolve(JSON.parse(body));
        }
      } catch (error) {
        reject(new Error('Invalid JSON'));
      }
    });
    
    req.on('error', reject);
  });
}

// Parse URL parameters and query string
export function parseRequest(req: IncomingMessage): { 
  pathname: string;
  query: Record<string, string>;
  params: Record<string, string>;
} {
  const url = new URL(req.url || '', 'http://localhost');
  const query: Record<string, string> = {};
  
  // Convert URLSearchParams to object
  for (const [key, value] of url.searchParams) {
    query[key] = value;
  }
  
  return {
    pathname: url.pathname,
    query,
    params: {} // Will be populated by route matching
  };
}

// Extend response with helper methods
export function extendResponse(res: ServerResponse): ExtendedResponse {
  const extRes = res as ExtendedResponse;
  
  extRes.json = function(data: any) {
    this.setHeader('Content-Type', 'application/json');
    this.end(JSON.stringify(data));
  };
  
  extRes.status = function(code: number) {
    this.statusCode = code;
    return this;
  };
  
  extRes.send = function(data: string) {
    this.end(data);
  };
  
  return extRes;
}

// CORS headers
export function setCORSHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// Route pattern matching
export function matchRoute(pathname: string, pattern: string): { 
  matches: boolean; 
  params: Record<string, string> 
} {
  const patternParts = pattern.split('/');
  const pathParts = pathname.split('/');
  
  if (patternParts.length !== pathParts.length) {
    return { matches: false, params: {} };
  }
  
  const params: Record<string, string> = {};
  
  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i];
    const pathPart = pathParts[i];
    
    if (patternPart.startsWith(':')) {
      // Dynamic parameter
      const paramName = patternPart.slice(1);
      params[paramName] = pathPart;
    } else if (patternPart !== pathPart) {
      // Static part doesn't match
      return { matches: false, params: {} };
    }
  }
  
  return { matches: true, params };
}