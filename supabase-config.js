/* ============================================================
   CENTRAL & STORES — Supabase Configuration
   Public anon key (safe for frontend)
   ============================================================ */

const SUPABASE_URL = 'https://xcdzozyhvkonvesqvxbp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhjZHpvenlodmtvbnZlc3F2eGJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5MDIwMTYsImV4cCI6MjEwNTQ3ODAxNn0.mX0u55mSR14FGr8Lt6ofENfaOqH6JcGp4ACjKnC3gKA';

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
