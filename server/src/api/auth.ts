import { Router, Request, Response } from 'express';
import { authService } from '../services/auth';
import { authenticate } from '../middleware/auth';

const router = Router();

/**
 * POST /api/auth/register
 * Register a new user
 */
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, full_name, company_name, role } = req.body;

    // Validate required fields
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    // Register user
    const result = await authService.register({
      email,
      password,
      full_name,
      company_name,
      role,
    });

    res.status(201).json({
      message: 'User registered successfully',
      user: result.user,
      token: result.token,
      apiKey: result.apiKey,
    });
  } catch (error: any) {
    console.error('Registration error:', error);
    res.status(400).json({ error: error.message || 'Registration failed' });
  }
});

/**
 * POST /api/auth/login
 * Login user
 */
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    // Validate required fields
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    // Login user
    const result = await authService.login({ email, password });

    res.status(200).json({
      message: 'Login successful',
      user: result.user,
      token: result.token,
    });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(401).json({ error: error.message || 'Login failed' });
  }
});

/**
 * POST /api/auth/logout
 * Logout user (invalidate token)
 */
router.post('/logout', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      await authService.logout(token);
    }

    res.status(200).json({ message: 'Logout successful' });
  } catch (error: any) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

/**
 * GET /api/auth/me
 * Get current user info
 */
router.get('/me', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const user = await authService.getUserById(req.user.userId);

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.status(200).json({ user });
  } catch (error: any) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

/**
 * GET /api/auth/api-keys
 * Get user's API keys
 */
router.get('/api-keys', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const apiKeys = await authService.getUserApiKeys(req.user.userId);

    res.status(200).json({ apiKeys });
  } catch (error: any) {
    console.error('Get API keys error:', error);
    res.status(500).json({ error: 'Failed to get API keys' });
  }
});

/**
 * POST /api/auth/api-keys
 * Generate new API key
 */
router.post('/api-keys', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { key_name } = req.body;

    if (!key_name) {
      res.status(400).json({ error: 'key_name is required' });
      return;
    }

    const apiKey = await authService.generateApiKey(req.user.userId, key_name);

    res.status(201).json({
      message: 'API key generated successfully',
      apiKey,
      warning: 'Save this API key securely. It will not be shown again.',
    });
  } catch (error: any) {
    console.error('Generate API key error:', error);
    res.status(500).json({ error: 'Failed to generate API key' });
  }
});

/**
 * DELETE /api/auth/api-keys/:keyId
 * Revoke API key
 */
router.delete('/api-keys/:keyId', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { keyId } = req.params;

    await authService.revokeApiKey(req.user.userId, keyId);

    res.status(200).json({ message: 'API key revoked successfully' });
  } catch (error: any) {
    console.error('Revoke API key error:', error);
    res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

/**
 * POST /api/auth/verify-token
 * Verify if token is valid
 */
router.post('/verify-token', async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.body;

    if (!token) {
      res.status(400).json({ error: 'Token is required', valid: false });
      return;
    }

    const decoded = authService.verifyToken(token);

    res.status(200).json({
      valid: true,
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
    });
  } catch (error: any) {
    res.status(200).json({ valid: false, error: error.message });
  }
});

export default router;


















