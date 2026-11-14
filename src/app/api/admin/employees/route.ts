/* eslint-disable @typescript-eslint/no-explicit-any */
import { requireAdmin } from "@/lib/requireAdmin";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  employeeIdToAuthEmail,
  STRICT_EMPLOYEE_ID_REGEX,
  normalizeEmployeeIdFormat,
  computeNextEmployeeId,
} from "@/lib/geo";
import { calculateShiftDurationHours } from "@/lib/pktTime";

function createPerRequestSupabaseAdmin(req: NextRequest, cfEnv: Record<string, any>) {

  const supabaseUrl = String(
    cfEnv.NEXT_PUBLIC_SUPABASE_URL ||
      cfEnv.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      ""
  ).trim();

  const anonKey = String(
    cfEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      cfEnv.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      ""
  ).trim();

  const serviceRoleKey = String(
    cfEnv.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      ""
  ).trim();

  const hasServiceRole = Boolean(
    serviceRoleKey &&
      !serviceRoleKey.includes("your-service-role-secret-key-here") &&
      serviceRoleKey !== anonKey
  );

  const activeKey = hasServiceRole ? serviceRoleKey : anonKey;
  if (!supabaseUrl || !activeKey) {
    return {
      supabaseAdmin: null,
      anonClient: null,
      hasServiceRole: false,
    };
  }

  const authHeader = req.headers.get("authorization") || "";

  const supabaseAdmin = createClient(supabaseUrl, activeKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    ...(!hasServiceRole && authHeader
      ? { global: { headers: { Authorization: authHeader } } }
      : {}),
  });

  const anonClient = createClient(supabaseUrl, anonKey || activeKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return {
    supabaseAdmin,
    anonClient,
    hasServiceRole,
  };
}

export async function GET(req: NextRequest, _context: any) {
  let cfEnv: Record<string, any> = {};
  try {
    const { env } = getCloudflareContext();
    cfEnv = env as Record<string, any>;
  } catch { /* Local development uses process.env below. */ }
  const denied = await requireAdmin(req, cfEnv);
  if (denied) return denied;

  try {
    const { supabaseAdmin } = createPerRequestSupabaseAdmin(req, cfEnv);
    if (!supabaseAdmin) {
      return NextResponse.json(
        {
          error:
            "Supabase is not configured in Cloudflare Worker environment.",
          employees: [],
          next_employee_id: "EMP 01",
        },
        { status: 503 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("role", "employee")
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json(
        {
          error: `Database Read Error (${error.code || "RLS"}): ${error.message}`,
          employees: [],
          next_employee_id: "EMP 01",
        },
        { status: 500 }
      );
    }

    const employees = data || [];
    const existingIds = employees.map((emp: any) =>
      String(emp.employee_id || "")
    );
    const nextEmployeeId = computeNextEmployeeId(existingIds);

    return NextResponse.json({
      employees,
      next_employee_id: nextEmployeeId,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load employees";
    return NextResponse.json(
      { error: msg, employees: [], next_employee_id: "EMP 01" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest, _context: any) {
  let cfEnv: Record<string, any> = {};
  try {
    const { env } = getCloudflareContext();
    cfEnv = env as Record<string, any>;
  } catch { /* Local development uses process.env below. */ }
  const denied = await requireAdmin(req, cfEnv);
  if (denied) return denied;

  try {
    // 1. Get Cloudflare Worker environment via getCloudflareContext() & create per-request client
    const { supabaseAdmin, anonClient, hasServiceRole } =
      createPerRequestSupabaseAdmin(req, cfEnv);

    if (!supabaseAdmin || !anonClient) {
      return NextResponse.json(
        {
          error:
            "Supabase credentials are missing in Cloudflare Worker environment (getCloudflareContext().env).",
        },
        { status: 503 }
      );
    }

    const body = await req.json();
    for (const field of ["monthly_salary", "basic_salary", "per_day_deduction", "hourly_rate", "overtime_rate"]) {
      if (body[field] !== undefined && body[field] !== "" && (!Number.isFinite(Number(body[field])) || Number(body[field]) < 0)) return NextResponse.json({ error: `${field} must be a finite non-negative number.` }, { status: 400 });
    }
    for (const field of ["duty_start_time", "duty_end_time"]) if (body[field] && !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(String(body[field]))) return NextResponse.json({ error: "Duty times must be valid HH:MM values." }, { status: 400 });

    const fullName = String(body.full_name || "")
      .trim()
      .replace(/\s+/g, " ");
    const rawEmpId = String(body.employee_id || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, " ");
    const employeeId = normalizeEmployeeIdFormat(rawEmpId);
    const password = String(body.password || "").trim();

    if (!fullName || !employeeId || !password) {
      return NextResponse.json(
        {
          error:
            "All fields are required: Please provide Full Name, Employee ID, and Password.",
        },
        { status: 400 }
      );
    }

    // Strict Employee ID Pattern Validation: "EMP 01", "EMP 02", "EMP 03", etc.
    if (!STRICT_EMPLOYEE_ID_REGEX.test(employeeId)) {
      return NextResponse.json(
        {
          error: `Invalid Employee ID format ('${rawEmpId}'). Must follow strict pattern: 'EMP 01', 'EMP 02', 'EMP 03', etc.`,
        },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        {
          error:
            "Password must be at least 6 characters long (Supabase Auth requirement).",
        },
        { status: 400 }
      );
    }

    const monthlySalary =
      parseFloat(String(body.monthly_salary ?? body.basic_salary ?? "0")) || 0;
    const dutyStartTime = (body.duty_start_time || "09:00").trim();
    const dutyEndTime = (body.duty_end_time || "17:00").trim();
    const shiftHours = calculateShiftDurationHours(dutyStartTime, dutyEndTime);

    const perDayDeduction =
      body.per_day_deduction !== undefined && body.per_day_deduction !== ""
        ? parseFloat(String(body.per_day_deduction)) || 0
        : Math.round((monthlySalary / 30) * 100) / 100;

    const hourlyRate =
      body.hourly_rate !== undefined && body.hourly_rate !== ""
        ? parseFloat(String(body.hourly_rate)) || 0
        : Math.round((perDayDeduction / shiftHours) * 100) / 100;

    const overtimeRate =
      body.overtime_rate !== undefined && body.overtime_rate !== ""
        ? parseFloat(String(body.overtime_rate)) || 0
        : hourlyRate;

    // Check against ALL existing employees for duplicate ID OR duplicate Full Name
    const { data: existingEmployees, error: checkError } = await supabaseAdmin
      .from("users")
      .select("id, employee_id, full_name");

    if (checkError) {
      return NextResponse.json(
        {
          error: `Database check failed: ${checkError.message}. Please run supabase/schema.sql in Supabase SQL Editor.`,
        },
        { status: 500 }
      );
    }

    const allRows = existingEmployees || [];

    const duplicateIdRow = allRows.find(
      (r: any) =>
        normalizeEmployeeIdFormat(String(r.employee_id || "")) === employeeId ||
        String(r.employee_id || "")
          .trim()
          .toUpperCase() === employeeId
    );

    if (duplicateIdRow) {
      return NextResponse.json(
        {
          error: `Duplicate Employee ID: '${employeeId}' is already assigned to ${duplicateIdRow.full_name}.`,
        },
        { status: 409 }
      );
    }

    const duplicateNameRow = allRows.find(
      (r: any) =>
        String(r.full_name || "")
          .trim()
          .replace(/\s+/g, " ")
          .toLowerCase() === fullName.toLowerCase()
    );

    if (duplicateNameRow) {
      return NextResponse.json(
        {
          error: `Duplicate Full Name: An employee named '${fullName}' already exists (${duplicateNameRow.employee_id}).`,
        },
        { status: 409 }
      );
    }

    const email = employeeIdToAuthEmail(employeeId);
    const userMetadata = {
      full_name: fullName,
      employee_id: employeeId,
      role: "employee",
      monthly_salary: monthlySalary,
      basic_salary: monthlySalary,
      per_day_deduction: perDayDeduction,
      hourly_rate: hourlyRate,
      overtime_rate: overtimeRate,
      duty_start_time: dutyStartTime,
      duty_end_time: dutyEndTime,
    };

    let authUserId: string | null = null;

    // 2. Primary Path: Use SUPABASE_SERVICE_ROLE_KEY via supabaseAdmin.auth.admin.createUser
    if (hasServiceRole) {
      const { data: createdAuth, error: createAuthError } =
        await supabaseAdmin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: userMetadata,
        });

      if (!createAuthError && createdAuth?.user) {
        authUserId = createdAuth.user.id;
      } else if (createAuthError) {
        const { data: listData } = await supabaseAdmin.auth.admin.listUsers();
        const existingAuthUser = listData?.users?.find(
          (u) => u.email?.toLowerCase() === email.toLowerCase()
        );

        if (existingAuthUser) {
          await supabaseAdmin.auth.admin.updateUserById(existingAuthUser.id, {
            password,
            email_confirm: true,
            user_metadata: userMetadata,
          });
          authUserId = existingAuthUser.id;
        } else {
          return NextResponse.json(
            {
              error: `Supabase Auth Admin Error: ${createAuthError.message}`,
            },
            { status: 400 }
          );
        }
      }
    } else {
      // 3. Fallback Path if SUPABASE_SERVICE_ROLE_KEY was not bound in Cloudflare Worker secrets
      const normalizedStart =
        dutyStartTime.length === 5 ? `${dutyStartTime}:00` : dutyStartTime;
      const normalizedEnd =
        dutyEndTime.length === 5 ? `${dutyEndTime}:00` : dutyEndTime;

      const { data: rpcEmployee, error: rpcError } = await supabaseAdmin.rpc(
        "admin_create_employee",
        {
          p_email: email,
          p_password: password,
          p_employee_id: employeeId,
          p_full_name: fullName,
          p_basic_salary: monthlySalary,
          p_per_day_deduction: perDayDeduction,
          p_hourly_rate: hourlyRate,
          p_overtime_rate: overtimeRate,
          p_duty_start_time: normalizedStart,
          p_duty_end_time: normalizedEnd,
          p_existing_auth_id: null,
        }
      );

      if (!rpcError && rpcEmployee) {
        const nextSuggested = computeNextEmployeeId([
          ...allRows.map((r: any) => String(r.employee_id || "")),
          employeeId,
        ]);
        return NextResponse.json({
          message: `Employee '${fullName}' (${employeeId}) created and auto-confirmed!`,
          employee: rpcEmployee,
          next_employee_id: nextSuggested,
        });
      }

      const { data: signUpData, error: signUpErr } =
        await anonClient.auth.signUp({
          email,
          password,
          options: { data: userMetadata },
        });

      const hasRealIdentity =
        signUpData?.user &&
        (!Array.isArray(signUpData.user.identities) ||
          signUpData.user.identities.length > 0);

      if (!signUpErr && signUpData?.user && hasRealIdentity) {
        authUserId = signUpData.user.id;
      } else {
        const { data: signInData } =
          await anonClient.auth.signInWithPassword({
            email,
            password,
          });
        if (signInData?.user) {
          authUserId = signInData.user.id;
        }
      }
    }

    if (!authUserId) {
      return NextResponse.json(
        {
          error:
            "Failed to create Auth user. Please add SUPABASE_SERVICE_ROLE_KEY in Cloudflare Worker Variables and Secrets (or run supabase/schema.sql in Supabase SQL Editor).",
        },
        { status: 500 }
      );
    }

    // 4. Confirm/synchronize row in `public.users`
    const { data: userRecord, error: upsertError } = await supabaseAdmin
      .from("users")
      .upsert(
        {
          id: authUserId,
          full_name: fullName,
          employee_id: employeeId,
          role: "employee",
          monthly_salary: monthlySalary,
          basic_salary: monthlySalary,
          per_day_deduction: perDayDeduction,
          hourly_rate: hourlyRate,
          overtime_rate: overtimeRate,
          duty_start_time: dutyStartTime,
          duty_end_time: dutyEndTime,
        },
        { onConflict: "id" }
      )
      .select()
      .single();

    if (upsertError) {
      return NextResponse.json(
        {
          error: `Database Insert Error (${upsertError.code || "DB"}): ${upsertError.message}`,
        },
        { status: 500 }
      );
    }

    const nextSuggested = computeNextEmployeeId([
      ...allRows.map((r: any) => String(r.employee_id || "")),
      employeeId,
    ]);

    return NextResponse.json({
      message: `Employee '${fullName}' (${employeeId}) created and auto-confirmed!`,
      employee: userRecord,
      next_employee_id: nextSuggested,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Unexpected error creating employee";
    return NextResponse.json(
      { error: `Server Exception: ${message}` },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest, _context: any) {
  let cfEnv: Record<string, any> = {};
  try {
    const { env } = getCloudflareContext();
    cfEnv = env as Record<string, any>;
  } catch { /* Local development uses process.env below. */ }
  const denied = await requireAdmin(req, cfEnv);
  if (denied) return denied;

  try {
    const { supabaseAdmin, hasServiceRole } = createPerRequestSupabaseAdmin(req, cfEnv);
    if (!supabaseAdmin) {
      return NextResponse.json(
        { error: "Supabase credentials missing." },
        { status: 503 }
      );
    }

    const body = await req.json();
    for (const field of ["monthly_salary", "basic_salary", "per_day_deduction", "hourly_rate", "overtime_rate"]) {
      if (body[field] !== undefined && body[field] !== "" && (!Number.isFinite(Number(body[field])) || Number(body[field]) < 0)) return NextResponse.json({ error: `${field} must be a finite non-negative number.` }, { status: 400 });
    }
    for (const field of ["duty_start_time", "duty_end_time"]) if (body[field] && !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(String(body[field]))) return NextResponse.json({ error: "Duty times must be valid HH:MM values." }, { status: 400 });

    const id = body.id;
    const fullName = String(body.full_name || "")
      .trim()
      .replace(/\s+/g, " ");
    const password = String(body.password || "").trim();

    if (!id || !fullName) {
      return NextResponse.json(
        { error: "Employee UUID and Full Name are required." },
        { status: 400 }
      );
    }

    const { data: allUsers } = await supabaseAdmin
      .from("users")
      .select("id, employee_id, full_name");

    const otherUsers = (allUsers || []).filter((u: any) => u.id !== id);

    const duplicateNameRow = otherUsers.find(
      (u: any) =>
        String(u.full_name || "")
          .trim()
          .replace(/\s+/g, " ")
          .toLowerCase() === fullName.toLowerCase()
    );
    if (duplicateNameRow) {
      return NextResponse.json(
        {
          error: `Duplicate Full Name: Another employee named '${fullName}' already exists (${duplicateNameRow.employee_id}).`,
        },
        { status: 409 }
      );
    }

    let employeeId = String(body.employee_id || "")
      .trim()
      .toUpperCase();
    if (!employeeId) {
      const currentEmp = (allUsers || []).find((u: any) => u.id === id);
      employeeId = currentEmp?.employee_id || "";
    }

    const monthlySalary =
      parseFloat(String(body.monthly_salary ?? body.basic_salary ?? "0")) || 0;
    const dutyStartTime = (body.duty_start_time || "09:00").trim();
    const dutyEndTime = (body.duty_end_time || "17:00").trim();
    const shiftHours = calculateShiftDurationHours(dutyStartTime, dutyEndTime);

    const perDayDeduction =
      body.per_day_deduction !== undefined && body.per_day_deduction !== ""
        ? parseFloat(String(body.per_day_deduction)) || 0
        : Math.round((monthlySalary / 30) * 100) / 100;

    const hourlyRate =
      body.hourly_rate !== undefined && body.hourly_rate !== ""
        ? parseFloat(String(body.hourly_rate)) || 0
        : Math.round((perDayDeduction / shiftHours) * 100) / 100;

    const overtimeRate =
      body.overtime_rate !== undefined && body.overtime_rate !== ""
        ? parseFloat(String(body.overtime_rate)) || 0
        : hourlyRate;

    if (password && password.length < 6) {
      return NextResponse.json(
        { error: "New password must be at least 6 characters long." },
        { status: 400 }
      );
    }

    if (hasServiceRole && employeeId) {
      const email = employeeIdToAuthEmail(employeeId);
      const updatePayload: {
        email: string;
        email_confirm: boolean;
        password?: string;
        user_metadata: Record<string, unknown>;
      } = {
        email,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          employee_id: employeeId,
          role: "employee",
          monthly_salary: monthlySalary,
          basic_salary: monthlySalary,
          per_day_deduction: perDayDeduction,
          hourly_rate: hourlyRate,
          overtime_rate: overtimeRate,
          duty_start_time: dutyStartTime,
          duty_end_time: dutyEndTime,
        },
      };
      if (password) {
        updatePayload.password = password;
      }

      await supabaseAdmin.auth.admin
        .updateUserById(id, updatePayload)
        .catch(() => null);
    }

    const updateFields: Record<string, unknown> = {
      full_name: fullName,
      monthly_salary: monthlySalary,
      basic_salary: monthlySalary,
      per_day_deduction: perDayDeduction,
      hourly_rate: hourlyRate,
      overtime_rate: overtimeRate,
      duty_start_time: dutyStartTime,
      duty_end_time: dutyEndTime,
    };
    if (employeeId) {
      updateFields.employee_id = employeeId;
    }

    const { data: updatedUser, error: dbError } = await supabaseAdmin
      .from("users")
      .update(updateFields)
      .eq("id", id)
      .select()
      .single();

    if (dbError) {
      return NextResponse.json(
        { error: `Database Update Error: ${dbError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: `Employee '${fullName}' updated successfully.`,
      employee: updatedUser,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Unexpected error updating employee";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, _context: any) {
  let cfEnv: Record<string, any> = {};
  try {
    const { env } = getCloudflareContext();
    cfEnv = env as Record<string, any>;
  } catch { /* Local development uses process.env below. */ }
  const denied = await requireAdmin(req, cfEnv);
  if (denied) return denied;

  try {
    const { supabaseAdmin, hasServiceRole } = createPerRequestSupabaseAdmin(req, cfEnv);
    if (!supabaseAdmin) {
      return NextResponse.json(
        { error: "Supabase credentials missing." },
        { status: 503 }
      );
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Employee UUID is required." },
        { status: 400 }
      );
    }

    if (hasServiceRole) {
      await supabaseAdmin.auth.admin.deleteUser(id).catch(() => null);
    }

    const { error: dbDelError } = await supabaseAdmin
      .from("users")
      .delete()
      .eq("id", id);

    if (dbDelError) {
      return NextResponse.json(
        { error: `Failed to delete employee: ${dbDelError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: "Employee deleted successfully.",
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Unexpected error deleting employee";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
