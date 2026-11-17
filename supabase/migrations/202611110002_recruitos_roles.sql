-- Add internal roles needed for recruitment management, sourcing, and finance.
alter type public.workspace_role add value if not exists 'recruitment_manager';
alter type public.workspace_role add value if not exists 'sourcer';
alter type public.workspace_role add value if not exists 'finance';
