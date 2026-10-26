-- =====================================================================
-- SIGAT Online - Migração 002: administrador pode excluir termos
-- (inclusive assinados). Cada exclusão guarda uma cópia na lixeira.
-- Cole no "SQL Editor" do Supabase e clique em RUN.
-- =====================================================================

-- Lixeira: cópia completa de cada termo excluído
create table if not exists public.termos_excluidos (
  id           bigint generated always as identity primary key,
  numero       text not null,
  dados        jsonb not null,
  excluido_por uuid,
  excluido_em  timestamptz not null default now()
);

alter table public.termos_excluidos enable row level security;

drop policy if exists lixeira_admin_ler on public.termos_excluidos;
create policy lixeira_admin_ler on public.termos_excluidos
  for select to authenticated
  using (public.eh_admin());

revoke all on public.termos_excluidos from anon;

-- Termo assinado: ninguém altera. Só o administrador pode excluir.
-- Também impede que a assinatura seja gravada por fora da função oficial.
create or replace function public.termos_antes_alterar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not public.eh_admin() then
      raise exception 'Somente o administrador pode excluir termos.';
    end if;
    insert into public.termos_excluidos (numero, dados, excluido_por)
    values (old.numero, to_jsonb(old), auth.uid());
    return old;
  end if;

  if old.status = 'assinado' then
    raise exception 'Termo % já foi assinado e não pode ser alterado.', old.numero;
  end if;

  -- Campos que nunca mudam por edição comum
  if new.id <> old.id or new.numero is distinct from old.numero
     or new.servidor_id <> old.servidor_id or new.servidor_nome is distinct from old.servidor_nome
     or new.criado_em <> old.criado_em then
    raise exception 'Campo protegido não pode ser alterado.';
  end if;

  -- Assinatura só pode ser registrada pela função assinar_termo
  if coalesce(current_setting('sigat.assinando', true), '') <> 'sim' then
    if new.status <> old.status
       or new.assinado_por is distinct from old.assinado_por
       or new.assinatura_img is distinct from old.assinatura_img
       or new.assinado_em is distinct from old.assinado_em
       or new.assinatura_ip is distinct from old.assinatura_ip
       or new.assinatura_navegador is distinct from old.assinatura_navegador then
      raise exception 'A assinatura só pode ser registrada pelo link de assinatura.';
    end if;
  end if;

  new.atualizado_em := now();
  return new;
end;
$$;
