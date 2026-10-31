#!/usr/bin/env python3
"""Refresh VibeProxy entries in Claude Code's native /model menu."""
import argparse
import json
import os
from pathlib import Path
import tempfile
import urllib.request

MARKER = 'Via VibeProxy · '
# These already have native rows; keep their native handling and descriptions.
BUILT_INS = {'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'}

def picker_rows(models):
    rows = []
    for model in sorted(models, key=lambda m: m['id'], reverse=True):
        ident = model['id']
        if ident in BUILT_INS or 'image' in ident.lower() or ident == 'codex-auto-review':
            continue
        # Unknown future providers are included as conversation models only when
        # the catalog explicitly advertises tool calling.
        if not ident.startswith(('claude-', 'gpt-')) and model.get('supports_tool_calls') is not True:
            continue
        profile = 'claude-opus-5'
        if ident.startswith('claude-'):
            if 'haiku' in ident: profile = 'claude-haiku-5-5'
            elif 'sonnet' in ident: profile = 'claude-sonnet-5-5'
        rows.append({'model':ident,'label':ident,'description':MARKER + model.get('owned_by','connected provider'), 'behavesAs':profile})
    return rows

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--quiet',action='store_true')
    args=parser.parse_args()
    base=os.environ.get('ANTHROPIC_BASE_URL','http://127.0.0.1:8317').rstrip('/')
    token=os.environ.get('ANTHROPIC_AUTH_TOKEN') or (Path.home()/'.cli-proxy-api/client-key').read_text().strip()
    req=urllib.request.Request(base+'/v1/models',headers={'Authorization':'Bearer '+token})
    with urllib.request.urlopen(req,timeout=5) as response: models=json.load(response)['data']
    if not models: raise RuntimeError('Proxy returned an empty catalog; existing menu retained')
    rows=picker_rows(models)
    if not rows: raise RuntimeError('No conversation models found; existing menu retained')
    directory=Path(os.environ.get('CLAUDE_CONFIG_DIR',str(Path.home()/'.claude')))
    path=directory/'settings.json'
    original=path.read_text() if path.exists() else '{}\n'
    settings=json.loads(original)
    picker=settings.setdefault('modelPicker',{})
    existing=[r for r in picker.get('options',[]) if not r.get('description','').startswith(MARKER)]
    owned={r['model'] for r in existing}
    picker['options']=existing+[r for r in rows if r['model'] not in owned]
    updated=json.dumps(settings,indent=2)+'\n'
    if updated!=original:
        backup=path.with_name('settings.before-vibeproxy-picker.json')
        if not backup.exists():
            fd=os.open(backup,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            with os.fdopen(fd,'w') as f: f.write(original)
        fd,name=tempfile.mkstemp(prefix='.picker-',dir=directory)
        try:
            with os.fdopen(fd,'w') as f: f.write(updated)
            os.replace(name,path)
        finally:
            if os.path.exists(name):os.unlink(name)
    if not args.quiet: print(f'Updated native /model menu: {len(rows)} VibeProxy entries; native Claude entries preserved.')

if __name__=='__main__':
    try: main()
    except Exception as error:
        # Avoid echoing credentials or remote error bodies.
        print(f'Model menu refresh failed ({type(error).__name__}); existing settings retained.',file=__import__('sys').stderr)
        raise SystemExit(1)
