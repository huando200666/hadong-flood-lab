"""Train only on verified labelled observations; no synthetic flood labels.
Usage: python ml/train.py path/to/observations.csv
"""
import json
import sys
from pathlib import Path
import joblib
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, confusion_matrix, average_precision_score

FEATURES = ['rain_1h_mm', 'rain_3h_mm', 'elevation_m', 'impervious_fraction', 'distance_drain_m']

def main():
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python ml/train.py observations.csv (see ml/README.md)')
    df = pd.read_csv(sys.argv[1])
    required = FEATURES + ['event_id', 'time', 'site_id', 'flooded']
    missing = sorted(set(required) - set(df.columns))
    if missing:
        raise SystemExit(f'Missing columns: {missing}')
    if df[required].isna().any().any():
        raise SystemExit('Missing values: resolve them before training.')
    df['time'] = pd.to_datetime(df['time'], utc=True, errors='raise')
    for col in FEATURES + ['flooded']:
        df[col] = pd.to_numeric(df[col], errors='raise')
    import numpy as np
    if not np.isfinite(df[FEATURES].to_numpy()).all():
        raise SystemExit('Non-finite features.')
    if not set(df.flooded.unique()) <= {0, 1} or df.flooded.nunique() != 2:
        raise SystemExit('flooded must contain both 0 and 1 labels.')
    if (df[['rain_1h_mm','rain_3h_mm','distance_drain_m']] < 0).any().any() or not df.impervious_fraction.between(0,1).all():
        raise SystemExit('Invalid rain, distance or impervious fraction.')
    if (df.rain_3h_mm < df.rain_1h_mm).any():
        raise SystemExit('3h rainfall must include the final 1h rainfall.')
    if df.duplicated(['site_id','time']).any():
        raise SystemExit('Duplicate site/time rows.')
    events = df.groupby('event_id')['time'].min().sort_values().index.tolist()
    if len(events) < 5:
        raise SystemExit('Need at least 5 independent events; this is only a software minimum, not evidence of scientific sufficiency.')
    cut = max(1, int(len(events)*0.8))
    train = df[df.event_id.isin(events[:cut])]
    test = df[df.event_id.isin(events[cut:])]
    if train.time.max() >= test.time.min():
        raise SystemExit('Events overlap the temporal holdout. Define independent non-overlapping events.')
    if min(train.flooded.nunique(), test.flooded.nunique()) < 2:
        raise SystemExit('Both holdout and training sets need positive and negative labels; collect more independent events.')
    model = RandomForestClassifier(n_estimators=300, min_samples_leaf=3, class_weight='balanced', random_state=42, n_jobs=-1)
    model.fit(train[FEATURES], train.flooded)
    pred = model.predict(test[FEATURES])
    probability = model.predict_proba(test[FEATURES])[:, list(model.classes_).index(1)]
    out = Path(__file__).parent / 'artifacts'
    out.mkdir(exist_ok=True)
    report = {'task':'Retrospective flood classification; NOT validated early-warning forecast', 'features':FEATURES, 'train_rows':len(train), 'test_rows':len(test), 'train_events':list(map(str,events[:cut])), 'test_events':list(map(str,events[cut:])), 'metrics':classification_report(test.flooded,pred,output_dict=True,zero_division=0), 'confusion_matrix_labels':[0,1], 'confusion_matrix':confusion_matrix(test.flooded,pred,labels=[0,1]).tolist(), 'average_precision':average_precision_score(test.flooded,probability), 'baseline_always_dry_accuracy':float((test.flooded==0).mean()), 'limitations':'Requires external spatial validation, calibration and evaluation with issue-time forecast inputs before early-warning use.'}
    joblib.dump({'model':model,'features':FEATURES},out/'flood-model.joblib')
    (out/'evaluation.json').write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding='utf-8')
    print(json.dumps(report,indent=2,ensure_ascii=False))

if __name__ == '__main__':
    main()
