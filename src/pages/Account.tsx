import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { useStore } from "../lib/store";
import { supabase, errorText } from "../lib/supabase";
import { ROLE_HELP, ROLE_LABEL, SWATCHES } from "../lib/format";
import { Avatar, Button, Card, ColorPicker, Field, Input, PageHeader } from "../components/ui";
import { useToast } from "../components/Toast";

export default function Account() {
  const { me, reloadMe } = useAuth();
  const store = useStore();
  const toast = useToast();
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [color, setColor] = useState(SWATCHES[0]);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState<"" | "profile" | "pw">("");

  useEffect(() => { if (me) { setName(me.full_name); setTitle(me.job_title); setColor(me.color); } }, [me?.id, me?.full_name, me?.job_title, me?.color]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!me) return null;

  async function saveProfile() {
    setBusy("profile");
    const { error } = await supabase.from("profiles").update({ full_name: name.trim(), job_title: title.trim(), color }).eq("id", me!.id);
    setBusy("");
    if (error) return toast.error(errorText(error));
    toast.success("Profile saved");
    reloadMe(); store.refresh();
  }

  async function savePw() {
    if (pw.length < 8) return toast.error("Use at least 8 characters.");
    if (pw !== pw2) return toast.error("The two passwords don't match.");
    setBusy("pw");
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy("");
    if (error) return toast.error(errorText(error));
    setPw(""); setPw2("");
    toast.success("Password changed");
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="My account" />
      <Card className="mb-5 p-5">
        <div className="mb-5 flex items-center gap-4">
          <Avatar person={{ ...me, full_name: name || me.full_name, color }} size={56} />
          <div>
            <p className="font-semibold">{me.full_name}</p>
            <p className="text-sm text-slate-500">Username <span className="font-mono">{me.username}</span> · {ROLE_LABEL[me.role]}</p>
            <p className="text-xs text-slate-400">{ROLE_HELP[me.role]}</p>
          </div>
        </div>
        <div className="space-y-4">
          <Field label="Full name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Job title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Avatar colour"><ColorPicker value={color} onChange={setColor} colors={SWATCHES} /></Field>
          <Button variant="primary" loading={busy === "profile"} disabled={!name.trim()} onClick={saveProfile}>Save profile</Button>
        </div>
      </Card>
      <Card className="p-5">
        <h2 className="mb-4 font-semibold">Change password</h2>
        <div className="space-y-4">
          <Field label="New password"><Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <Field label="Type it again"><Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
          <Button loading={busy === "pw"} onClick={savePw} disabled={!pw}>Change password</Button>
        </div>
      </Card>
    </div>
  );
}
