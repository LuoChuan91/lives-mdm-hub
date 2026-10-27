"""Mailbox triage: TF-IDF + logistic regression, exported to the browser (assets/engine.js)."""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, confusion_matrix, precision_recall_fscore_support
from sklearn.model_selection import train_test_split

CLASSES = ["purchase_order", "enquiry", "setup_request", "follow_up"]
LABELS = {"purchase_order": "Purchase order", "enquiry": "Enquiry", "setup_request": "Setup request",
          "follow_up": "Follow-up"}
# Greetings and sign-offs carry no intent (otherwise "thank you" starts to predict an order)
STOP_WORDS = ["dear", "hi", "hello", "team", "thank", "thanks", "you", "your", "regards", "best", "warm",
              "sincerely", "cheers", "the", "and", "of", "to", "for", "we", "our", "is", "are", "this", "that",
              "it", "in", "on", "at", "be", "as", "with", "by", "from", "an", "or", "me", "my", "us", "am", "pm"]


def text_of(df: pd.DataFrame) -> pd.Series:
    return (df["subject"].fillna("") + " \n " + df["body"].fillna("")).astype(str)


def train(messages: pd.DataFrame, seed: int = 7):
    X = text_of(messages)
    y = messages["true_type"]
    X_tr, X_te, y_tr, y_te, idx_tr, idx_te = train_test_split(
        X, y, messages.index, test_size=0.25, random_state=seed, stratify=y)
    vec = TfidfVectorizer(lowercase=True, ngram_range=(1, 2), min_df=2, max_features=2000, sublinear_tf=True,
                          token_pattern=r"(?u)\b\w\w+\b", stop_words=STOP_WORDS)
    Xtr = vec.fit_transform(X_tr)
    clf = LogisticRegression(max_iter=3000, C=4.0, class_weight="balanced")
    clf.fit(Xtr, y_tr)
    Xte = vec.transform(X_te)
    pred = clf.predict(Xte)
    proba = clf.predict_proba(Xte)
    classes = list(clf.classes_)
    p, r, f, s = precision_recall_fscore_support(y_te, pred, labels=CLASSES, zero_division=0)
    conf = confusion_matrix(y_te, pred, labels=CLASSES)
    maxp = proba.max(axis=1)
    confident = maxp >= 0.8
    metrics = dict(
        accuracy=round(float(accuracy_score(y_te, pred)), 4),
        test_size=int(len(y_te)), train_size=int(len(y_tr)),
        per_class=[dict(cls=c, label=LABELS[c], precision=round(float(p[i]), 3), recall=round(float(r[i]), 3),
                        support=int(s[i])) for i, c in enumerate(CLASSES)],
        confusion=dict(labels=CLASSES, matrix=conf.tolist()),
        auto_share=round(float(confident.mean()), 3),
        auto_accuracy=round(float((pred[confident] == np.asarray(y_te)[confident]).mean()), 4),
    )
    vocab = vec.vocabulary_
    inv = sorted(vocab.items(), key=lambda kv: kv[1])
    model = dict(
        classes=classes,
        terms=[t for t, _ in inv],
        idf=[round(float(v), 5) for v in vec.idf_],
        coef=[[round(float(v), 5) for v in row] for row in clf.coef_],
        intercept=[round(float(v), 5) for v in clf.intercept_],
        ngram=[1, 2], sublinear_tf=True, token_pattern=r"\b\w\w+\b", stop_words=STOP_WORDS,
    )
    # held-out messages with sklearn's probabilities, for the browser parity test
    parity = [dict(text=t, proba=[round(float(v), 6) for v in row])
              for t, row in zip(list(X_te[:200]), proba[:200])]
    return model, metrics, parity, vec, clf


def predict_all(messages, vec, clf):
    return clf.predict(vec.transform(text_of(messages)))
