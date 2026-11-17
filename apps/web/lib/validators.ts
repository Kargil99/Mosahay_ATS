import { z } from "zod";

export const clientSchema = z.object({ name: z.string().min(2).max(180), website: z.string().optional(), notes: z.string().optional() });
const optionalNumber = z.preprocess(value => value === "" || value == null ? undefined : Number(value), z.number().finite().nonnegative().optional());
const optionalDate = z.preprocess(value => value === "" || value == null ? undefined : value, z.string().date().optional());
export const jobSchema = z.object({ title: z.string().min(2), description: z.string().min(20), client_id: z.string().optional(), location: z.string().optional(), work_arrangement: z.string().optional(), employment_type: z.string().optional(), vacancies: optionalNumber, salary_min: optionalNumber, salary_max: optionalNumber, experience_min: optionalNumber, experience_max: optionalNumber, application_deadline: optionalDate, department: z.string().max(120).optional(), industry: z.string().max(120).optional() }).superRefine((value, context) => {
  if (value.salary_min != null && value.salary_max != null && value.salary_max < value.salary_min) context.addIssue({ code: "custom", path: ["salary_max"], message: "Maximum salary must be at least the minimum." });
  if (value.experience_min != null && value.experience_max != null && value.experience_max < value.experience_min) context.addIssue({ code: "custom", path: ["experience_max"], message: "Maximum experience must be at least the minimum." });
  if (value.vacancies != null && (!Number.isInteger(value.vacancies) || value.vacancies < 1 || value.vacancies > 10000)) context.addIssue({ code: "custom", path: ["vacancies"], message: "Enter 1 to 10,000 open positions." });
});
export const workspaceSchema = z.object({ name: z.string().min(2).max(120) });
