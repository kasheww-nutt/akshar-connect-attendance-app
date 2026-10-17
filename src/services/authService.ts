import type { User } from '../types';
import { INITIAL_ADMIN, INITIAL_TEACHERS } from '../data/mockDatabase';
import { supabase, isSupabaseConfigured } from './supabaseClient';

const SESSION_KEY = 'akshar_connect_auth_v2';

// Baseline organization accounts for offline / development / fallback mode
const REGISTERED_ACCOUNTS: Record<string, { password: string; user: User }> = {
  'admin@aksharpaaul.org': {
    password: 'admin123',
    user: INITIAL_ADMIN
  },
  'riya.patil@aksharpaaul.org': {
    password: 'teacher123',
    user: {
      id: 'usr-tch-1',
      name: INITIAL_TEACHERS[0].name,
      email: INITIAL_TEACHERS[0].email,
      role: 'TEACHER',
      teacherId: INITIAL_TEACHERS[0].id,
      phone: INITIAL_TEACHERS[0].phone
    }
  },
  'vikram.kulkarni@aksharpaaul.org': {
    password: 'teacher123',
    user: {
      id: 'usr-tch-2',
      name: INITIAL_TEACHERS[1].name,
      email: INITIAL_TEACHERS[1].email,
      role: 'TEACHER',
      teacherId: INITIAL_TEACHERS[1].id,
      phone: INITIAL_TEACHERS[1].phone
    }
  },
  'anita.sharma@aksharpaaul.org': {
    password: 'teacher123',
    user: {
      id: 'usr-tch-3',
      name: INITIAL_TEACHERS[2].name,
      email: INITIAL_TEACHERS[2].email,
      role: 'TEACHER',
      teacherId: INITIAL_TEACHERS[2].id,
      phone: INITIAL_TEACHERS[2].phone
    }
  },
  'suresh.pawar@aksharpaaul.org': {
    password: 'teacher123',
    user: {
      id: 'usr-tch-4',
      name: INITIAL_TEACHERS[3].name,
      email: INITIAL_TEACHERS[3].email,
      role: 'TEACHER',
      teacherId: INITIAL_TEACHERS[3].id,
      phone: INITIAL_TEACHERS[3].phone
    }
  }
};

class AuthService {
  private currentUser: User | null = null;
  private listeners: ((user: User | null) => void)[] = [];

  constructor() {
    this.restoreSession();
    if (isSupabaseConfigured && supabase) {
      this.initSupabaseAuth();
    }
  }

  private async initSupabaseAuth(): Promise<void> {
    if (!supabase) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        await this.syncSupabaseProfile(session.user.id, session.user.email || '');
      }

      supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          await this.syncSupabaseProfile(session.user.id, session.user.email || '');
        } else if (event === 'SIGNED_OUT') {
          this.currentUser = null;
          localStorage.removeItem(SESSION_KEY);
          this.notify();
        }
      });
    } catch (e) {
      console.error('Error initializing Supabase Auth:', e);
    }
  }

  private async syncSupabaseProfile(userId: string, email: string): Promise<User | null> {
    if (!supabase) return null;
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error || !profile) {
        // Fallback: build temporary profile from auth metadata
        const user: User = {
          id: userId,
          name: email.split('@')[0],
          email,
          role: 'TEACHER'
        };
        this.currentUser = user;
        localStorage.setItem(SESSION_KEY, JSON.stringify(user));
        this.notify();
        return user;
      }

      const user: User = {
        id: profile.id,
        name: profile.name,
        email: profile.email,
        role: profile.role,
        teacherId: profile.teacher_id || undefined,
        phone: profile.phone || undefined,
        avatar: profile.avatar_url || undefined
      };

      this.currentUser = user;
      localStorage.setItem(SESSION_KEY, JSON.stringify(user));
      this.notify();
      return user;
    } catch (err) {
      console.error('Failed to sync profile from Supabase:', err);
      return null;
    }
  }

  private restoreSession(): void {
    try {
      const stored = localStorage.getItem(SESSION_KEY);
      if (stored) {
        this.currentUser = JSON.parse(stored);
      }
    } catch (e) {
      console.error('Failed to restore session', e);
      this.currentUser = null;
    }
  }

  public getCurrentUser(): User | null {
    if (!this.currentUser) {
      this.restoreSession();
    }
    return this.currentUser;
  }

  public async login(email: string, password: string): Promise<User> {
    const normalizedEmail = email.trim().toLowerCase();

    // 1. If Supabase is configured, authenticate via Supabase GoTrue Auth
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password
        });

        if (!error && data?.user) {
          const syncedUser = await this.syncSupabaseProfile(data.user.id, data.user.email || normalizedEmail);
          if (syncedUser) {
            return syncedUser;
          }

          // If profile table sync fails, return standard User object
          const fallbackUser: User = {
            id: data.user.id,
            name: data.user.email?.split('@')[0] || 'User',
            email: data.user.email || normalizedEmail,
            role: 'TEACHER'
          };
          this.currentUser = fallbackUser;
          localStorage.setItem(SESSION_KEY, JSON.stringify(fallbackUser));
          this.notify();
          return fallbackUser;
        }
      } catch (authErr) {
        console.warn('Supabase Auth error, checking fallback accounts:', authErr);
      }
    }

    // 2. Fallback to local accounts when Supabase credentials are not present
    const account = REGISTERED_ACCOUNTS[normalizedEmail];
    if (!account) {
      throw new Error('Invalid email or user account not found.');
    }

    if (account.password !== password) {
      throw new Error('Invalid password. Please check your credentials and try again.');
    }

    const demoUser: User = { ...account.user, isDemo: true };
    this.currentUser = demoUser;
    localStorage.setItem(SESSION_KEY, JSON.stringify(demoUser));
    this.notify();
    return demoUser;
  }

  public async logout(): Promise<void> {
    this.currentUser = null;
    localStorage.removeItem(SESSION_KEY);
    this.notify();

    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.auth.signOut();
      } catch (err) {
        console.error('Error signing out of Supabase:', err);
      }
    }
  }

  public subscribe(callback: (user: User | null) => void): () => void {
    this.listeners.push(callback);
    callback(this.currentUser);
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  private notify(): void {
    this.listeners.forEach(cb => cb(this.currentUser));
  }
}

export const authService = new AuthService();
export { REGISTERED_ACCOUNTS };
