import { useEffect, useState } from 'react';
import { useAppData } from '../context/AppDataContext';
import { useTheme } from '../theme/ThemeProvider';
import { ChampionsSvc } from '../data/entities';
import { Card, Field, EmptyState } from '../components/ui';
import { useToast } from '../components/Toast';
import {
  AppMode, FontFamily, FontFamilyLabel, FontFamilyStack, FontSize, FontSizeLabel, optionsOf,
} from '../lib/enums';

export default function CustomizeScreen() {
  const { currentChampion, reload } = useAppData();
  const { applyTheme, resetToSaved } = useTheme();
  const toast = useToast();

  const [mode, setMode] = useState<number>(currentChampion?.crd49_appmode ?? AppMode.Light);
  const [family, setFamily] = useState<number>(currentChampion?.crd49_fontfamily ?? FontFamily.SegoeUI);
  const [size, setSize] = useState<number>(currentChampion?.crd49_fontsize ?? FontSize.Default);
  const [saving, setSaving] = useState(false);

  // Live preview whenever a selection changes.
  useEffect(() => {
    applyTheme({ appmode: mode, fontfamily: family, fontsize: size });
  }, [mode, family, size, applyTheme]);

  // Restore the saved theme if the user navigates away without saving.
  useEffect(() => () => resetToSaved(), [resetToSaved]);

  if (!currentChampion) {
    return <Card><EmptyState icon="🎨" title="No champion profile" message="Personalization is available once you have a champion record." /></Card>;
  }

  async function save() {
    setSaving(true);
    try {
      const res = await ChampionsSvc.update(currentChampion!.abs_championid, {
        crd49_appmode: mode,
        crd49_fontfamily: family,
        crd49_fontsize: size,
      } as never);
      if (!res.success) throw new Error(res.error?.message ?? 'Update failed');
      toast.success('Preferences saved.');
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save preferences.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Customize</h1>
          <div className="page-subtitle">Personalize how the hub looks — just for you.</div>
        </div>
        <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save Changes'}</button>
      </div>

      <div className="grid grid-2">
        <Card title="🎨 Appearance">
          <Field label="App mode">
            <div className="row">
              {[{ v: AppMode.Light, l: '☀️ Light' }, { v: AppMode.Dark, l: '🌙 Dark' }].map((o) => (
                <button key={o.v} className={`btn ${mode === o.v ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode(o.v)}>{o.l}</button>
              ))}
            </div>
          </Field>
          <Field label="Font size">
            <div className="row">
              {optionsOf(FontSizeLabel).map((o) => (
                <button key={o.value} className={`btn ${size === o.value ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSize(o.value)}>{o.label}</button>
              ))}
            </div>
          </Field>
          <Field label="Font family">
            <select className="select" value={family} onChange={(e) => setFamily(Number(e.target.value))}>
              {optionsOf(FontFamilyLabel).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        </Card>

        <Card title="👀 Live Preview">
          <div style={{ fontFamily: FontFamilyStack[family] }}>
            <h2 style={{ marginBottom: 8 }}>The quick brown fox</h2>
            <p className="text-muted">
              This preview reflects your selected font family, size and app mode in real time.
              Click <span className="strong">Save Changes</span> to persist them to your champion profile.
            </p>
            <div className="row mt-16">
              <span className="points-badge">120 pts</span>
              <span className="pill green">Active</span>
              <button className="btn btn-primary btn-sm">Sample button</button>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
