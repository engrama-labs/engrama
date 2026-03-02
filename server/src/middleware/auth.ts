import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
        role: string;
      };
    }
  }
}

/**
 * Middleware to verify JWT token from Authorization header
 */
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token
    const decoded = authService.verifyToken(token);

    // Attach user info to request
    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
    };

    next();
  } catch (error: any) {
    console.error('Authentication error:', error);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

/**
 * Middleware to verify API key from X-API-Key header
 */
export const authenticateApiKey = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Get API key from X-API-Key header
    const apiKey = req.headers['x-api-key'] as string;
    
    if (!apiKey) {
      res.status(401).json({ error: 'No API key provided' });
      return;
    }

    // Verify API key
    const userId = await authService.verifyApiKey(apiKey);

    if (!userId) {
      res.status(401).json({ error: 'Invalid or expired API key' });
      return;
    }

    // Get user info
    const user = await authService.getUserById(userId);

    if (!user || !user.is_active) {
      res.status(401).json({ error: 'User account is disabled' });
      return;
    }

    // Attach user info to request
    req.user = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };

    next();
  } catch (error: any) {
    console.error('API key authentication error:', error);
    res.status(401).json({ error: 'Authentication failed' });
  }
};

/**
 * Middleware to allow either JWT or API key authentication
 */
export const authenticateFlexible = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // Try JWT first
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authenticate(req, res, next);
  }

  // Try API key
  const apiKey = req.headers['x-api-key'];
  if (apiKey) {
    return authenticateApiKey(req, res, next);
  }

  // No authentication provided
  res.status(401).json({ error: 'Authentication required. Provide either Bearer token or X-API-Key header.' });
};

/**
 * Middleware to check if user has specific role
 */
export const requireRole = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
};

/**
 * Optional authentication - attach user if token or API key is provided, but don't require it
 */
export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Try JWT token first
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const decoded = authService.verifyToken(token);
        req.user = {
          userId: decoded.userId,
          email: decoded.email,
          role: decoded.role,
        };
        return next();
      } catch (tokenError) {
        // Token verification failed, try API key instead
        console.log('[optionalAuth] Token verification failed, trying API key...');
      }
    }

    // Try API key
    const apiKey = req.headers['x-api-key'] as string;
    if (apiKey) {
      try {
        const userId = await authService.verifyApiKey(apiKey);
        if (userId) {
          const user = await authService.getUserById(userId);
          if (user && user.is_active) {
            req.user = {
              userId: user.id,
              email: user.email,
              role: user.role,
            };
            return next();
          }
        }
      } catch (apiKeyError) {
        console.log('[optionalAuth] API key verification failed, continuing without auth');
      }
    }

    // Also try API key from Authorization header (for backward compatibility)
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const possibleApiKey = authHeader.substring(7);
      // API keys typically start with specific prefixes, but we'll try anyway
      if (possibleApiKey.length > 20) { // API keys are usually longer than JWT tokens
        try {
          const userId = await authService.verifyApiKey(possibleApiKey);
          if (userId) {
            const user = await authService.getUserById(userId);
            if (user && user.is_active) {
              req.user = {
                userId: user.id,
                email: user.email,
                role: user.role,
              };
              return next();
            }
          }
        } catch (apiKeyError) {
          // Ignore and continue
        }
      }
    }
  } catch (error) {
    console.error('[optionalAuth] Unexpected error:', error);
    // Ignore errors for optional auth
  }
  
  next();
};
