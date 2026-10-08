import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-app-session-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: 'Supabase function secrets are not configured' }, 500)

  const authorization = req.headers.get('Authorization') ?? ''
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } })
  const adminClient = createClient(supabaseUrl, serviceRoleKey)
  const { data: caller } = await userClient.auth.getUser()
  if (!caller.user) return json({ error: 'Not authenticated' }, 401)

  const { data: callerProfile } = await adminClient.from('profiles').select('role').eq('id', caller.user.id).maybeSingle()
  if (callerProfile?.role !== 'admin') return json({ error: 'Only a full administrator can permanently delete students' }, 403)

  const body = await req.json().catch(() => null) as { studentId?: string } | null
  const studentId = body?.studentId
  if (!studentId) return json({ error: 'Student ID is required' }, 400)
  if (studentId === caller.user.id) return json({ error: 'You cannot delete your own account' }, 400)

  const { data: target } = await adminClient.from('profiles').select('role, full_name').eq('id', studentId).maybeSingle()
  if (target?.role !== 'student') return json({ error: 'Only student accounts can be permanently deleted' }, 400)

  const { data: frames, error: frameError } = await adminClient.from('face_enrollment_frames').select('storage_path').eq('student_id', studentId)
  if (frameError) return json({ error: frameError.message }, 500)
  const paths = (frames ?? []).map((frame) => frame.storage_path as string)
  if (paths.length) {
    const { error: storageError } = await adminClient.storage.from('face-frames').remove(paths)
    if (storageError) return json({ error: `Face images could not be deleted: ${storageError.message}` }, 500)
  }

  const { error: prepareError } = await userClient.rpc('prepare_student_permanent_deletion', { p_student_id: studentId })
  if (prepareError) return json({ error: prepareError.message }, 500)

  const { error: authError } = await adminClient.auth.admin.deleteUser(studentId)
  if (authError) return json({ error: `Authentication account could not be deleted: ${authError.message}` }, 500)

  return json({ deleted: true, studentId, name: target.full_name })
})
