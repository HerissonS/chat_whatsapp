import { useQueryClient } from '@tanstack/react-query';
import { Play, Trash2, Upload, Volume1, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useToast } from '../components/Toast';
import { Button, cx, IconButton } from '../components/ui';
import { api } from '../lib/api';
import { DEFAULT_SOUND, getCustomSound, playSound, removeCustomSound, saveCustomSound, SOUNDS, setSoundSettings, type SoundId, type SoundSettings } from '../lib/sound';

/** Mantém o tocador de som em sincronia com as preferências do usuário logado. */
export function useSoundPreferences() {
  const { me } = useAuth();
  const sound = me?.preferences?.notificationSound;
  const volume = me?.preferences?.soundVolume;
  useEffect(() => {
    setSoundSettings({ sound: sound ?? DEFAULT_SOUND.sound, volume: volume ?? DEFAULT_SOUND.volume });
  }, [sound, volume]);
}

/** Escolha do som de notificação: opções, volume, pré-visualização e arquivo próprio. */
export function SoundSettingsForm({ onDone }: { onDone: () => void }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<SoundSettings>({
    sound: me?.preferences?.notificationSound ?? DEFAULT_SOUND.sound,
    volume: me?.preferences?.soundVolume ?? DEFAULT_SOUND.volume,
  });
  const [custom, setCustom] = useState(() => getCustomSound());
  const [saving, setSaving] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const options: Array<{ id: SoundId; label: string; hint?: string }> = [
    ...SOUNDS.map((s) => ({ id: s.id, label: s.label })),
    { id: 'custom', label: 'Arquivo próprio', hint: custom ? custom.name : 'Nenhum arquivo escolhido' },
    { id: 'none', label: 'Sem som' },
  ];

  const pick = (sound: SoundId) => {
    setForm((f) => ({ ...f, sound }));
    if (sound !== 'none' && (sound !== 'custom' || custom)) void playSound({ ...form, sound });
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      await saveCustomSound(f);
      setCustom(getCustomSound());
      const next = { ...form, sound: 'custom' as const };
      setForm(next);
      void playSound(next);
    } catch (err) {
      toast.error(err);
    } finally {
      if (file.current) file.current.value = '';
    }
  };

  const save = async () => {
    if (form.sound === 'custom' && !custom) {
      toast.error('Escolha um arquivo de áudio ou outra opção.');
      return;
    }
    setSaving(true);
    try {
      await api.post('auth/preferences', { notificationSound: form.sound, soundVolume: form.volume });
      setSoundSettings(form);
      await qc.invalidateQueries({ queryKey: ['me'] });
      toast.success('Som de notificação salvo.');
      onDone();
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const VolIcon = form.volume === 0 ? VolumeX : form.volume < 50 ? Volume1 : Volume2;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Toca quando chega mensagem em uma conversa que não está aberta na tela. Vale para o seu usuário em qualquer computador.</p>

      <ul className="divide-y divide-border/40 rounded-app border border-border/40" role="radiogroup" aria-label="Som de notificação">
        {options.map((o) => (
          <li key={o.id} className="flex items-center gap-2 px-3 py-1.5">
            <button
              type="button"
              role="radio"
              aria-checked={form.sound === o.id}
              onClick={() => pick(o.id)}
              className="flex min-w-0 flex-1 items-center gap-3 py-1 text-left text-sm text-text"
            >
              <span
                className={cx('flex size-4 shrink-0 items-center justify-center rounded-full border-2', form.sound === o.id ? 'border-primary' : 'border-border')}
                aria-hidden
              >
                {form.sound === o.id && <span className="size-2 rounded-full bg-primary" />}
              </span>
              <span className="min-w-0">
                <span className="block">{o.label}</span>
                {o.hint && <span className="block truncate text-xs text-muted">{o.hint}</span>}
              </span>
            </button>
            {o.id === 'custom' && (
              <>
                <Button variant="secondary" size="sm" icon={<Upload className="size-3.5" />} onClick={() => file.current?.click()}>
                  {custom ? 'Trocar' : 'Escolher'}
                </Button>
                {custom && (
                  <IconButton
                    label="Remover arquivo"
                    onClick={() => {
                      removeCustomSound();
                      setCustom(null);
                      if (form.sound === 'custom') setForm((f) => ({ ...f, sound: DEFAULT_SOUND.sound }));
                    }}
                  >
                    <Trash2 className="size-4" />
                  </IconButton>
                )}
              </>
            )}
            {o.id !== 'none' && (o.id !== 'custom' || custom) && (
              <IconButton label={`Ouvir ${o.label}`} onClick={() => void playSound({ ...form, sound: o.id })}>
                <Play className="size-4" />
              </IconButton>
            )}
          </li>
        ))}
      </ul>
      <input
        ref={file}
        type="file"
        accept="audio/mpeg,audio/ogg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,.mp3,.ogg,.wav,.m4a"
        className="hidden"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <p className="text-xs text-muted">Arquivo próprio: MP3, OGG, WAV ou M4A, até 300 KB e 6 segundos. Fica salvo só neste navegador.</p>

      <label className="block">
        <span className="mb-1.5 flex items-center gap-2 text-sm font-medium text-text">
          <VolIcon className="size-4 text-muted" /> Volume: {form.volume}%
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={form.volume}
          onChange={(e) => setForm({ ...form, volume: Number(e.target.value) })}
          onPointerUp={() => void playSound(form)}
          onKeyUp={() => void playSound(form)}
          className="w-full cursor-pointer accent-[var(--color-primary)]"
        />
      </label>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
        <Button onClick={() => void save()} loading={saving}>
          Salvar
        </Button>
      </div>
    </div>
  );
}
