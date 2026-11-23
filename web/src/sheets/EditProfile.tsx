import type { Me } from '@mandrix/shared';
import { Camera } from '@phosphor-icons/react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Avatar, PrimaryBtn, Sheet, useFilePicker } from '../components/ui';
import { api, errMsg, upload } from '../lib/api';
import { qc, useMe } from '../lib/data';
import { closeSheet, toast } from '../lib/store';

export function EditProfileSheet() {
  const nav = useNavigate();
  const { data: me } = useMe();
  const [displayName, setDisplayName] = useState(me?.displayName ?? '');
  const [username, setUsername] = useState(me?.username ?? '');
  const [city, setCity] = useState(me?.city ?? '');
  const [bio, setBio] = useState(me?.bio ?? '');
  const [busy, setBusy] = useState(false);

  const refresh = (u: Me) => {
    qc.setQueryData(['me'], u);
    for (const k of [['profile'], ['feed'], ['stories'], ['user-posts']]) qc.invalidateQueries({ queryKey: k });
  };

  const { input, open } = useFilePicker('image/*', async (f) => {
    try {
      refresh(await upload<Me>('/api/me/avatar', f, f.name));
      toast('Photo de profil mise à jour');
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  });

  if (!me) return null;

  const save = async () => {
    setBusy(true);
    try {
      const u = await api<Me>('/api/me', { method: 'PATCH', body: { displayName, username, city, bio } });
      refresh(u);
      toast('Profil enregistré');
      closeSheet();
      if (u.username !== me.username) nav('/profil', { replace: true });
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const label = 'px-1 text-[0.8125rem] font-bold text-mute';
  return (
    <Sheet title="Modifier le profil" onClose={closeSheet}>
      {input}
      <button type="button" onClick={open} className="tap relative self-center border-0 bg-transparent p-0" aria-label="Changer la photo de profil">
        <Avatar user={me} size={92} ring />
        <span className="absolute right-0 bottom-0 grid h-9 w-9 place-items-center rounded-full bg-brand text-white shadow-blue">
          <Camera size={18} weight="fill" />
        </span>
      </button>
      <span className={label}>Nom affiché</span>
      <input className="field" value={displayName} maxLength={40} onChange={(e) => setDisplayName(e.target.value)} />
      <span className={label}>Pseudo</span>
      <input className="field" value={username} maxLength={20} onChange={(e) => setUsername(e.target.value.toLowerCase())} autoCapitalize="none" />
      <span className={label}>Ville</span>
      <input className="field" value={city} maxLength={60} placeholder="Aix-en-Provence" onChange={(e) => setCity(e.target.value)} />
      <span className={label}>Bio</span>
      <textarea
        className="field h-auto min-h-[88px] resize-none py-3 leading-snug"
        value={bio}
        maxLength={160}
        placeholder="Quelques mots sur toi"
        onChange={(e) => setBio(e.target.value)}
      />
      <PrimaryBtn className="h-[54px] flex-none text-base" onClick={save} disabled={busy || !displayName.trim()}>
        Enregistrer
      </PrimaryBtn>
    </Sheet>
  );
}
