// SIGAT Online - Edge Function "criar-servidor"
// Cria um novo usuário (servidor ou admin). Só um administrador ativo pode chamar.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function resposta(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return resposta({ erro: "Método não permitido." }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const servico = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Confere quem está chamando
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: quem, error: erroQuem } = await servico.auth.getUser(token);
    if (erroQuem || !quem?.user) return resposta({ erro: "Sessão inválida. Entre novamente." }, 401);

    const { data: perfil } = await servico
      .from("perfis").select("papel, ativo").eq("id", quem.user.id).single();
    if (!perfil || perfil.papel !== "admin" || !perfil.ativo) {
      return resposta({ erro: "Apenas administradores podem cadastrar servidores." }, 403);
    }

    const { nome, email, senha, papel } = await req.json();
    if (!nome?.trim() || !email?.trim()) return resposta({ erro: "Preencha nome e e-mail." }, 400);
    if (!senha || senha.length < 8) return resposta({ erro: "A senha inicial deve ter pelo menos 8 caracteres." }, 400);
    const papelFinal = papel === "admin" ? "admin" : "servidor";

    const { data: novo, error: erroNovo } = await servico.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password: senha,
      email_confirm: true,
      user_metadata: { nome: nome.trim() },
    });
    if (erroNovo) {
      const msg = /already/i.test(erroNovo.message) ? "Já existe um usuário com esse e-mail." : erroNovo.message;
      return resposta({ erro: msg }, 400);
    }

    if (papelFinal === "admin") {
      await servico.from("perfis").update({ papel: "admin" }).eq("id", novo.user.id);
    }
    return resposta({ ok: true, id: novo.user.id });
  } catch (e) {
    console.error(e);
    return resposta({ erro: "Erro interno ao cadastrar servidor." }, 500);
  }
});
