import { REPORT_REASONS, type ReportTarget } from '@mandrix/shared';
import { Flag } from '@phosphor-icons/react';
import { useState } from 'react';
import { create } from 'zustand';
import { api, errMsg } from '../lib/api';
import { qc } from '../lib/data';
import { toast } from '../lib/store';
import { cx, PrimaryBtn, Sheet, Switch } from './ui';

interface ReportReq {
  targetType: ReportTarget;
  targetId: string;
  /** Prénom de l'auteur, pour proposer de le bloquer. */
  authorName?: string;
}

const useReport = create<{ req: ReportReq | null }>(() => ({ req: null }));

/** Ouvre la feuille « Signaler » pour un post, un commentaire, une story, un message ou un compte. */
export const openReport = (req: ReportReq) => useReport.setState({ req });

const LABEL: Record<ReportTarget, string> = {
  post: 'ce post',
  comment: 'ce commentaire',
  story: 'cette story',
  message: 'ce message',
  user: 'ce compte',
};

export function ReportHost() {
  const req = useReport((s) => s.req);
  const [reason, setReason] = useState<string | null>(null);
  const [block, setBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!req) return null;

  const close = () => {
    useReport.setState({ req: null });
    setReason(null);
    setBlock(false);
  };

  const send = async () => {
    if (!reason) return;
    setBusy(true);
    try {
      const r = await api<{ hidden: boolean }>('/api/reports', { body: { targetType: req.targetType, targetId: req.targetId, reason, block } });
      toast(r.hidden ? 'Merci, le contenu est masqué en attendant la modération' : 'Merci, un administrateur va regarder');
      if (block || r.hidden) for (const k of [['feed'], ['stories'], ['friends'], ['conversations'], ['comments'], ['profile']]) qc.invalidateQueries({ queryKey: k });
      close();
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={`Signaler ${LABEL[req.targetType]}`} onClose={close}>
      <div className="flex flex-col gap-4">
        <p className="m-0 text-[0.9375rem] text-mute">Ton signalement est anonyme. Au bout de trois signalements, le contenu est masqué en attendant un administrateur.</p>
        <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Motif">
          {REPORT_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={reason === r}
              onClick={() => setReason(r)}
              className={cx(
                'tap flex h-12 items-center rounded-[18px] border-0 px-4 text-left text-[0.9375rem] font-semibold transition-colors',
                reason === r ? 'bg-ink text-inv' : 'bg-soft text-ink',
              )}
            >
              {r}
            </button>
          ))}
        </div>
        {req.targetType !== 'user' && req.authorName && (
          <button
            type="button"
            role="switch"
            aria-checked={block}
            onClick={() => setBlock((b) => !b)}
            className="tap flex items-center gap-3 rounded-[18px] border-0 bg-soft p-3.5 text-left text-ink"
          >
            <span className="flex-1">
              <span className="block text-[0.9375rem] font-bold">Bloquer {req.authorName}</span>
              <span className="block text-[0.8125rem] text-mute">Vous ne verrez plus vos contenus et ne pourrez plus vous écrire.</span>
            </span>
            <Switch on={block} />
          </button>
        )}
        <PrimaryBtn tone="danger" disabled={!reason || busy} onClick={send}>
          <Flag size={18} weight="fill" /> Envoyer le signalement
        </PrimaryBtn>
      </div>
    </Sheet>
  );
}
