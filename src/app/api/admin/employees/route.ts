import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getSupabaseAdmin, RuntimeEnv } from "@/lib/supabaseAdmin";
import { employeeIdToAuthEmail } from "@/lib/geo";
import { calculateShiftDurationHours } from "@/lib/pktTime";

interface RouteContext {
  env?: RuntimeEnv;
  params?: Promise<Record<string, string>>;
}

function resolveCloudflareOrProcessEnv(context?: RouteContext): RuntimeEnv {
  let cfEnv: RuntimeEnv = {};
  try {
    const cfContext = getCloudflareContext();
    if (cfContext?.env) {
      cfEnv = cfContext.env as unknown as RuntimeEnv;
    }
  } catch {
    // Fallback when running locally outside Cloudflare Workers runtime
  }

  return {
    NEXT_PUBLIC_SUPABASE_URL:
      (context?.env?.NEXT_PUBLIC_SUPABASE_URL as string) ||
      (cfEnv.NEXT_PUBLIC_SUPABASE_URL as string) ||
      (context?.env?.SUPABASE_URL as string) ||
      (cfEnv.SUPABASE_URL as string) ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      "",
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      (context?.env?.NEXT_PUBLIC_SUPABASE_ANON_KEY as string) ||
      (cfEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY as string) ||
      (context?.env?.SUPABASE_ANON_KEY as string) ||
      (cfEnv.SUPABASE_ANON_KEY as string) ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      "",
    SUPABASE_SERVICE_ROLE_KEY:
      (context?.env?.SUPABASE_SERVICE_ROLE_KEY as string) ||
      (cfEnv.SUPABASE_SERVICE_ROLE_KEY as string) ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      "",
  };
}

export async function GET(req: NextRequest, context?: RouteContext) {
  try {
    const { client, isConfigured } = getSupabaseAdmin(req, context);
    if (!isConfigured || !client) {
      return NextResponse.json(
        {
          error:
            "Supabase is not configured. Please verify NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY.",
          employees: [],
        },
        { status: 503 }
      );
    }

    const { data, error } = await client
      .from("users")
      .select("*")
      .eq("role", "employee")
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        {
          error: `Database Read Error (${error.code || "RLS"}): ${error.message}`,
          employees: [],
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ employees: data || [] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load employees";
    return NextResponse.json({ error: msg, employees: [] }, { status: 500 });
  }
}

export async function POST(req: NextRequest, context?: RouteContext) {
  try {
    // 1. Fetch environment keys from Cloudflare `context.env` / `getCloudflareContext().env` or `process.env`
    const env = resolveCloudflareOrProcessEnv(context);
    const supabaseUrl = (env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
    const serviceRoleKey = (
      context?.env?.SUPABASE_SERVICE_ROLE_KEY ||
      env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      ""
    ).trim();

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        {
          error:
            "Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL in Cloudflare Worker environment (context.env) or process.env.",
        },
        { status: 503 }
      );
    }

    // 2. Create the Supabase Admin client with SUPABASE_SERVICE_ROLE_KEY
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const body = await req.json();
    const fullName = (body.full_name || "").trim();
    const employeeId = (body.employee_id || "").trim().toUpperCase();
    const password = (body.password || "").trim();

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

    if (!fullName || !employeeId || !password) {
      return NextResponse.json(
        {
          error:
            "All fields are required: Please provide Full Name, Employee ID, and Password.",
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

    // Check if Employee ID already exists in `public.users`
    const { data: existingRow, error: checkError } = await supabaseAdmin
      .from("users")
      .select("id, employee_id")
      .ilike("employee_id", employeeId)
      .maybeSingle();

    if (checkError) {
      return NextResponse.json(
        {
          error: `Database check failed: ${checkError.message}. Please run supabase/schema.sql in Supabase SQL Editor.`,
        },
        { status: 500 }
      );
    }

    if (existingRow) {
      return NextResponse.json(
        {
          error: `Duplicate Employee ID: '${employeeId}' already exists.`,
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

    // 3. Call supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata })
    // The Postgres trigger `on_auth_user_created` (`public.handle_new_user`) automatically inserts into `public.users`.
    let authUserId: string | null = null;
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
      // If user email already exists in `auth.users`, locate and update it
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

    if (!authUserId) {
      return NextResponse.json(
        { error: "Failed to obtain Auth User ID from Supabase." },
        { status: 500 }
      );
    }

    // 4. Confirm/synchronize row in `public.users` (already inserted by `handle_new_user` trigger)
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

    return NextResponse.json({
      message: `Employee '${fullName}' (${employeeId}) created and auto-confirmed!`,
      employee: userRecord,
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

export async function PUT(req: NextRequest, context?: RouteContext) {
  try {
    const { client, isConfigured, hasServiceRole } = getSupabaseAdmin(
      req,
      context
    );
    if (!isConfigured || !client) {
      return NextResponse.json(
        { error: "Supabase credentials missing." },
        { status: 503 }
      );
    }

    const body = await req.json();
    const id = body.id;
    const fullName = (body.full_name || "").trim();
    const password = (body.password || "").trim();

    if (!id || !fullName) {
      return NextResponse.json(
        { error: "Employee UUID and Full Name are required." },
        { status: 400 }
      );
    }

    let employeeId = (body.employee_id || "").trim().toUpperCase();
    if (!employeeId) {
      const { data: existingEmp } = await client
        .from("users")
        .select("employee_id")
        .eq("id", id)
        .maybeSingle();
      employeeId = existingEmp?.employee_id || "";
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

      await client.auth.admin
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

    const { data: updatedUser, error: dbError } = await client
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

export async function DELETE(req: NextRequest, context?: RouteContext) {
  try {
    const { client, isConfigured, hasServiceRole } = getSupabaseAdmin(
      req,
      context
    );
    if (!isConfigured || !client) {
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
      await client.auth.admin.deleteUser(id).catch(() => null);
    }

    const { error: dbDelError } = await client
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
