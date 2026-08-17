import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type StudentInput = {
  studentId: string
  fullName: string
  email: string
  phone?: string
  courseCodes?: string[]
  temporaryPassword?: string
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: 'Supabase function secrets are not configured' }, 500)
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  const { data: callerData, error: callerError } = await userClient.auth.getUser()
  if (callerError || !callerData.user) return json({ error: 'Not authenticated' }, 401)

  const { data: callerProfile, error: profileError } = await userClient
    .from('profiles')
    .select('role')
    .eq('id', callerData.user.id)
    .maybeSingle()

  if (profileError || callerProfile?.role !== 'admin') {
    return json({ error: 'Only admins can bulk-create students' }, 403)
  }

  const payload = await req.json().catch(() => null) as { students?: StudentInput[] } | null
  const students = payload?.students ?? []
  if (!Array.isArray(students) || students.length === 0) return json({ error: 'No students were provided' }, 400)
  if (students.length > 500) return json({ error: 'Upload at most 500 students at a time' }, 400)

  const { data: courses } = await adminClient.from('courses').select('id, code')
  const courseByCode = new Map((courses ?? []).map((course) => [String(course.code).toUpperCase(), course.id]))
  const results: Array<{ email: string; studentId: string; status: 'created' | 'error'; message: string }> = []

  for (const student of students) {
    const email = student.email.trim().toLowerCase()
    const studentId = student.studentId.trim()
    const fullName = student.fullName.trim()
    const password = student.temporaryPassword?.trim()

    if (!email || !studentId || !fullName || !password) {
      results.push({ email, studentId, status: 'error', message: 'Missing required student fields or temporary password' })
      continue
    }

    const { data: existingProfiles } = await adminClient
      .from('profiles')
      .select('id')
      .or(`email.eq.${email},student_id.eq.${studentId}`)
      .limit(1)

    if (existingProfiles?.length) {
      results.push({ email, studentId, status: 'error', message: 'Profile already exists' })
      continue
    }

    const { data: createdUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        student_id: studentId,
        phone: student.phone ?? '',
      },
    })

    if (createError || !createdUser.user) {
      results.push({ email, studentId, status: 'error', message: createError?.message ?? 'Auth user was not created' })
      continue
    }

    const userId = createdUser.user.id
    const { error: upsertError } = await adminClient.from('profiles').upsert({
      id: userId,
      role: 'student',
      full_name: fullName,
      student_id: studentId,
      email,
      phone: student.phone ?? null,
      must_change_password: true,
    })

    if (upsertError) {
      results.push({ email, studentId, status: 'error', message: upsertError.message })
      continue
    }

    const memberships = (student.courseCodes ?? [])
      .map((code) => courseByCode.get(code.trim().toUpperCase()))
      .filter(Boolean)
      .map((courseId) => ({ course_id: courseId, student_id: userId }))

    if (memberships.length) {
      await adminClient.from('course_memberships').upsert(memberships, { onConflict: 'course_id,student_id' })
    }

    results.push({ email, studentId, status: 'created', message: 'Student account created' })
  }

  return json({
    created: results.filter((result) => result.status === 'created').length,
    failed: results.filter((result) => result.status === 'error').length,
    results,
  })
})
