import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import { config } from '../../config';
import crypto from 'crypto';

const supabase = createClient(config.supabase.url, config.supabase.key);

// JWT secret (use environment variable in production)
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = '7d'; // 7 days

export interface User {
  id: string;
  email: string;
  full_name: string | null;
  company_name: string | null;
  role: string;
  is_active: boolean;
  email_verified: boolean;
  created_at: string;
}

export interface RegisterData {
  email: string;
  password: string;
  full_name?: string;
  company_name?: string;
  role?: 'developer' | 'startup' | 'enterprise';
}

export interface LoginData {
  email: string;
  password: string;
}

export class AuthService {
  /**
   * Register a new user
   */
  async register(data: RegisterData): Promise<{ user: User; token: string; apiKey: string }> {
    const { email, password, full_name, company_name, role = 'developer' } = data;

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new Error('Invalid email format');
    }

    // Validate password strength
    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters long');
    }

    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (existingUser) {
      throw new Error('User with this email already exists');
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 10);

    // Create user
    const { data: newUser, error: userError } = await supabase
      .from('users')
      .insert({
        email,
        password_hash,
        full_name,
        company_name,
        role,
        email_verified: false, // Email verification can be added later
        is_active: true,
      })
      .select()
      .single();

    if (userError || !newUser) {
      console.error('Error creating user:', userError);
      throw new Error('Failed to create user account');
    }

    // Generate JWT token
    const token = this.generateToken(newUser);

    // Generate default API key
    const apiKey = await this.generateApiKey(newUser.id, 'Default API Key');

    // Create session
    await this.createSession(newUser.id, token);

    const user: User = {
      id: newUser.id,
      email: newUser.email,
      full_name: newUser.full_name,
      company_name: newUser.company_name,
      role: newUser.role,
      is_active: newUser.is_active,
      email_verified: newUser.email_verified,
      created_at: newUser.created_at,
    };

    return { user, token, apiKey };
  }

  /**
   * Login user
   */
  async login(data: LoginData): Promise<{ user: User; token: string }> {
    const { email, password } = data;

    // Get user by email
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (userError || !userData) {
      throw new Error('Invalid email or password');
    }

    // Check if user is active
    if (!userData.is_active) {
      throw new Error('Account is disabled. Please contact support.');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, userData.password_hash);
    if (!isPasswordValid) {
      throw new Error('Invalid email or password');
    }

    // Update last login
    await supabase
      .from('users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', userData.id);

    // Generate JWT token
    const token = this.generateToken(userData);

    // Create session
    await this.createSession(userData.id, token);

    const user: User = {
      id: userData.id,
      email: userData.email,
      full_name: userData.full_name,
      company_name: userData.company_name,
      role: userData.role,
      is_active: userData.is_active,
      email_verified: userData.email_verified,
      created_at: userData.created_at,
    };

    return { user, token };
  }

  /**
   * Verify JWT token
   */
  verifyToken(token: string): any {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      return decoded;
    } catch (error) {
      throw new Error('Invalid or expired token');
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<User | null> {
    const { data, error } = await supabase
      .from('users')
      .select('id, email, full_name, company_name, role, is_active, email_verified, created_at')
      .eq('id', userId)
      .single();

    if (error || !data) {
      return null;
    }

    return data as User;
  }

  /**
   * Generate JWT token
   */
  private generateToken(user: any): string {
    return jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
  }

  /**
   * Create session
   */
  private async createSession(userId: string, token: string): Promise<void> {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    await supabase.from('user_sessions').insert({
      user_id: userId,
      token_hash: tokenHash,
      expires_at: expiresAt.toISOString(),
    });
  }

  /**
   * Generate API key for user
   */
  async generateApiKey(userId: string, keyName: string): Promise<string> {
    // Generate random API key
    const apiKey = `me_${crypto.randomBytes(32).toString('hex')}`;
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const keyPrefix = apiKey.substring(0, 10);

    // Store in database
    const { error } = await supabase.from('api_keys').insert({
      user_id: userId,
      key_name: keyName,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      is_active: true,
    });

    if (error) {
      console.error('Error creating API key:', error);
      throw new Error('Failed to generate API key');
    }

    return apiKey;
  }

  /**
   * Verify API key
   */
  async verifyApiKey(apiKey: string): Promise<string | null> {
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const keyPrefix = apiKey.substring(0, 10);

    const { data, error } = await supabase
      .from('api_keys')
      .select('user_id, is_active, expires_at')
      .eq('key_prefix', keyPrefix)
      .eq('key_hash', keyHash)
      .single();

    if (error || !data || !data.is_active) {
      return null;
    }

    // Check if expired
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return null;
    }

    // Update last used
    await supabase
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('key_hash', keyHash);

    return data.user_id;
  }

  /**
   * Get user's API keys
   */
  async getUserApiKeys(userId: string): Promise<any[]> {
    const { data, error } = await supabase
      .from('api_keys')
      .select('id, key_name, key_prefix, is_active, created_at, last_used_at, expires_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching API keys:', error);
      return [];
    }

    return data || [];
  }

  /**
   * Revoke API key
   */
  async revokeApiKey(userId: string, keyId: string): Promise<void> {
    const { error } = await supabase
      .from('api_keys')
      .update({ is_active: false })
      .eq('id', keyId)
      .eq('user_id', userId);

    if (error) {
      console.error('Error revoking API key:', error);
      throw new Error('Failed to revoke API key');
    }
  }

  /**
   * Logout (invalidate session)
   */
  async logout(token: string): Promise<void> {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    
    await supabase
      .from('user_sessions')
      .delete()
      .eq('token_hash', tokenHash);
  }
}

export const authService = new AuthService();


















