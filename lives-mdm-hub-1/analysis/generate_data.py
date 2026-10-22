"""Synthetic data generator for the Lives Group MDM case prototype.

EVERYTHING HERE IS SYNTHETIC. Customer names (apart from National University
Hospital, which the case brief itself uses as its example), registration numbers,
addresses, phone numbers, bank details and order volumes are invented.

The seed is fixed, so anyone can rebuild identical data:

    python analysis/generate_data.py

Outputs (all in data/):
    customers.csv          customer master as it sits in SAP B1 today (duplicates included)
    items.csv              item master (a few near-duplicates included)
    vendors.csv            vendor master (synthetic bank details)
    cost_centres.csv       cost centre master
    purchase_orders.csv    12 months of customer purchase orders, Oct 2025 - Sep 2026
    inbound_messages.csv   shared-mailbox messages: orders, enquiries, setup requests, follow-ups
    mdm_requests.csv       12 months of email-era MDM requests with approval timestamps
    prospects.csv          prospects with an account setup still in flight on 30 Sep 2026
    planted_patterns.json  ground truth for every pattern deliberately planted in the data
"""
from __future__ import annotations

import json
import math
from datetime import date, datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

SEED = 2026
ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"

MONTHS = [f"{y}-{m:02d}" for y, m in [(2025, 10), (2025, 11), (2025, 12)] + [(2026, m) for m in range(1, 10)]]
AS_OF = date(2026, 9, 30)

COUNTRIES = {
    "SG": "Singapore",
    "MY": "Malaysia",
    "ID": "Indonesia",
    "TH": "Thailand",
    "VN": "Vietnam",
}
PRODUCTS = {
    "A": dict(name="Diagnostic reagents", entity="SPD", unit="kits", price=185.0),
    "B": dict(name="Lab consumables", entity="QTS", unit="boxes", price=24.0),
    "C": dict(name="Instruments & service", entity="QTG", unit="units", price=1450.0),
}
ENTITIES = {
    "SPD": "Diagnostics business (sells Product A)",
    "QTS": "Lab supplies business (sells Product B)",
    "QTG": "Instruments & service business (sells Product C)",
}

rng = np.random.default_rng(SEED)


def pick(seq):
    return seq[int(rng.integers(len(seq)))]


def lognormal(mean: float, sd: float, size=None):
    sigma2 = math.log(1 + (sd * sd) / (mean * mean))
    mu = math.log(mean) - sigma2 / 2
    return rng.lognormal(mu, math.sqrt(sigma2), size)


# ---------------------------------------------------------------------------
# 1. Customer master
# ---------------------------------------------------------------------------
# (country, legal name, segment, size, city, creating entity, products bought, extras)
#   extras: key   -> storyline handle used below
#           new   -> date the account setup request was submitted (new customer this year)
#           churn -> (month volumes start falling, last month with orders)  real churn
#           c_boost -> multiplier on Product C demand
CUSTOMERS = [
    # Singapore
    ("SG", "National University Hospital", "Public hospital", "L", "Singapore", "SPD", "AB", {"key": "NUH"}),
    ("SG", "Harbourfront General Hospital", "Public hospital", "L", "Singapore", "SPD", "ABC", {}),
    ("SG", "Seletar Valley Hospital Pte Ltd", "Private hospital", "M", "Singapore", "SPD", "ABC", {}),
    ("SG", "Novena Specialist Medical Centre Pte Ltd", "Private hospital", "M", "Singapore", "SPD", "AB", {}),
    ("SG", "Marina Bay Medical Group Pte Ltd", "Clinic group", "M", "Singapore", "SPD", "AB", {}),
    ("SG", "Lion City Diagnostics Pte Ltd", "Independent lab", "L", "Singapore", "SPD", "ABC", {"key": "LIONCITY"}),
    ("SG", "Kent Ridge Pathology Laboratory Pte Ltd", "Independent lab", "M", "Singapore", "SPD", "ABC", {}),
    ("SG", "Orchard Women's & Children's Clinic Pte Ltd", "Clinic group", "S", "Singapore", "SPD", "AB", {}),
    ("SG", "Tampines East Polyclinic Group", "Clinic group", "S", "Singapore", "QTS", "B", {}),
    ("SG", "Science Park Research Institute", "Research institute", "M", "Singapore", "QTS", "BC", {}),
    ("SG", "Bukit Timah Heart Centre Pte Ltd", "Private hospital", "S", "Singapore", "SPD", "AB", {}),
    ("SG", "Queenstown Renal Centre Pte Ltd", "Clinic group", "S", "Singapore", "QTS", "B", {}),
    ("SG", "Jurong West Medical Centre Pte Ltd", "Private hospital", "M", "Singapore", "SPD", "ABC", {}),
    ("SG", "Pasir Ris Family Clinics Pte Ltd", "Clinic group", "S", "Singapore", "SPD", "AB", {}),
    ("SG", "Clementi Eye & ENT Centre Pte Ltd", "Clinic group", "S", "Singapore", "QTS", "B", {}),
    ("SG", "Woodlands Integrated Care Hospital", "Public hospital", "L", "Singapore", "SPD", "ABC", {}),
    ("SG", "Changi Biomedical Laboratory Pte Ltd", "Independent lab", "M", "Singapore", "SPD", "AB", {}),
    ("SG", "Telok Ayer Health Screening Pte Ltd", "Clinic group", "M", "Singapore", "SPD", "AB", {}),
    ("SG", "Sentosa Wellness Clinic Pte Ltd", "Clinic group", "S", "Singapore", "QTS", "B", {}),
    ("SG", "Punggol Community Hospital", "Public hospital", "M", "Singapore", "SPD", "AB", {}),
    ("SG", "Bedok Specialist Laboratory Pte Ltd", "Independent lab", "S", "Singapore", "SPD", "A", {}),
    ("SG", "Holland Village Medical Group Pte Ltd", "Clinic group", "S", "Singapore", "SPD", "AB", {}),
    ("SG", "Kallang Sports Medicine Centre Pte Ltd", "Clinic group", "S", "Singapore", "QTS", "B", {}),
    ("SG", "Lion City Dental Group Pte Ltd", "Clinic group", "S", "Singapore", "QTS", "B", {"key": "N_LIONDENTAL"}),
    ("SG", "Tengah Medical Centre Pte Ltd", "Private hospital", "M", "Singapore", "SPD", "AB", {"new": "2026-01-19"}),
    # Malaysia
    ("MY", "Klang Valley Specialist Hospital Sdn Bhd", "Private hospital", "L", "Petaling Jaya", "SPD", "ABC", {"key": "KVSH"}),
    ("MY", "Penang Pathology Services Sdn Bhd", "Independent lab", "M", "George Town", "QTS", "AB", {"key": "PENANG"}),
    ("MY", "Johor Specialist Hospital Sdn Bhd", "Private hospital", "L", "Johor Bahru", "SPD", "ABC", {"key": "JOHOR"}),
    ("MY", "Selangor Women's Hospital Sdn Bhd", "Private hospital", "M", "Shah Alam", "SPD", "AB", {}),
    ("MY", "Ipoh Heritage Hospital Sdn Bhd", "Private hospital", "M", "Ipoh", "SPD", "ABC", {"churn": ("2026-03", "2026-07")}),
    ("MY", "Kuching Riverside Medical Centre Sdn Bhd", "Private hospital", "M", "Kuching", "SPD", "ABC", {}),
    ("MY", "Melaka Central Laboratory Sdn Bhd", "Independent lab", "S", "Melaka", "SPD", "AB", {}),
    ("MY", "Petaling Heart Institute Sdn Bhd", "Private hospital", "M", "Petaling Jaya", "SPD", "AB", {}),
    ("MY", "Shah Alam Clinic Group Sdn Bhd", "Clinic group", "S", "Shah Alam", "QTS", "B", {}),
    ("MY", "Hospital Lembah Hijau", "Public hospital", "L", "Kuala Lumpur", "SPD", "ABC", {}),
    ("MY", "Seremban Medical Centre Sdn Bhd", "Private hospital", "S", "Seremban", "SPD", "AB", {}),
    ("MY", "Kota Bharu Diagnostics Sdn Bhd", "Independent lab", "S", "Kota Bharu", "SPD", "A", {}),
    ("MY", "Ampang Eye Specialist Centre Sdn Bhd", "Clinic group", "S", "Kuala Lumpur", "QTS", "B", {}),
    ("MY", "Bangsar Family Clinics Sdn Bhd", "Clinic group", "S", "Kuala Lumpur", "SPD", "AB", {}),
    ("MY", "Putra Biotech Research Institute", "Research institute", "M", "Cyberjaya", "QTS", "BC", {}),
    ("MY", "Hospital Bukit Indah", "Public hospital", "M", "Johor Bahru", "SPD", "AB", {}),
    ("MY", "Miri Coastal Medical Centre Sdn Bhd", "Private hospital", "S", "Miri", "SPD", "AB", {}),
    ("MY", "Alor Setar Pathology Lab Sdn Bhd", "Independent lab", "S", "Alor Setar", "SPD", "AB", {}),
    ("MY", "Subang Jaya Specialist Hospital Sdn Bhd", "Private hospital", "M", "Subang Jaya", "SPD", "ABC", {}),
    ("MY", "Kuantan Medical Laboratory Sdn Bhd", "Independent lab", "S", "Kuantan", "QTS", "B", {}),
    ("MY", "Cheras Dialysis Centre Sdn Bhd", "Clinic group", "S", "Kuala Lumpur", "QTS", "B", {}),
    ("MY", "Penang Island Hospital Sdn Bhd", "Private hospital", "M", "George Town", "SPD", "ABC", {}),
    ("MY", "Cyberjaya Specialist Centre Sdn Bhd", "Private hospital", "M", "Cyberjaya", "SPD", "AB", {"new": "2025-11-24"}),
    ("MY", "Seremban Lab Services Sdn Bhd", "Independent lab", "S", "Seremban", "SPD", "AB", {"new": "2026-04-27"}),
    # Indonesia
    ("ID", "PT Rumah Sakit Surabaya Medika", "Private hospital", "L", "Surabaya", "SPD", "ABC", {"key": "SURABAYA"}),
    ("ID", "PT Jakarta Central Laboratory", "Independent lab", "L", "Jakarta", "SPD", "ABC", {}),
    ("ID", "RSUD Kota Harapan", "Public hospital", "L", "Jakarta", "SPD", "AB", {}),
    ("ID", "PT Rumah Sakit Bandung Medika", "Private hospital", "M", "Bandung", "SPD", "ABC", {}),
    ("ID", "PT Medan Diagnostika Lab", "Independent lab", "M", "Medan", "SPD", "AB", {}),
    ("ID", "PT Bali Nusa Medical Centre", "Private hospital", "M", "Denpasar", "SPD", "AB", {"new": "2026-02-02"}),
    ("ID", "PT Klinik Pratama Semarang", "Clinic group", "S", "Semarang", "QTS", "B", {}),
    ("ID", "PT Yogyakarta Klinik Group", "Clinic group", "S", "Yogyakarta", "SPD", "AB", {"churn": ("2026-01", "2026-04")}),
    ("ID", "PT Makassar Harapan Hospital", "Private hospital", "M", "Makassar", "SPD", "AB", {"new": "2026-05-11"}),
    ("ID", "PT Rumah Sakit Tangerang Prima", "Private hospital", "M", "Tangerang", "SPD", "AB", {"new": "2026-03-09"}),
    ("ID", "PT Rumah Sakit Palembang Mitra", "Private hospital", "M", "Palembang", "SPD", "AB", {"new": "2026-06-15"}),
    ("ID", "PT Rumah Sakit Medan Kasih", "Private hospital", "L", "Medan", "SPD", "ABC", {"new": "2026-01-12"}),
    ("ID", "PT Rumah Sakit Bandung Sehat", "Private hospital", "M", "Bandung", "SPD", "AB", {"new": "2026-04-06"}),
    ("ID", "PT Surabaya Lab Services", "Independent lab", "S", "Surabaya", "QTS", "B", {}),
    ("ID", "PT Bekasi Medical Group", "Clinic group", "S", "Bekasi", "SPD", "AB", {}),
    ("ID", "PT Depok Klinik Utama", "Clinic group", "S", "Depok", "QTS", "B", {}),
    ("ID", "PT Lembaga Riset Nusantara", "Research institute", "M", "Bogor", "QTS", "BC", {}),
    ("ID", "PT Rumah Sakit Malang Sejahtera", "Private hospital", "M", "Malang", "SPD", "ABC", {}),
    ("ID", "PT Batam Medical Centre", "Private hospital", "S", "Batam", "SPD", "AB", {}),
    ("ID", "PT Solo Diagnostika", "Independent lab", "S", "Surakarta", "SPD", "A", {}),
    ("ID", "PT Pontianak Klinik Group", "Clinic group", "S", "Pontianak", "QTS", "B", {}),
    ("ID", "PT Rumah Sakit Jakarta Selatan Prima", "Private hospital", "L", "Jakarta", "SPD", "ABC", {}),
    # Thailand
    ("TH", "Bangkok Riverside Hospital Co., Ltd.", "Private hospital", "L", "Bangkok", "QTS", "ABC", {"key": "BKKRIVER"}),
    ("TH", "Chiang Mai Clinical Laboratory Co., Ltd.", "Independent lab", "M", "Chiang Mai", "SPD", "AB", {"key": "CHIANGMAI"}),
    ("TH", "Pattaya Bay Hospital Co., Ltd.", "Private hospital", "L", "Pattaya", "SPD", "AB", {"churn": ("2026-02", "2026-06")}),
    ("TH", "Khon Kaen Medical Centre Co., Ltd.", "Private hospital", "M", "Khon Kaen", "SPD", "AB", {"new": "2026-03-02"}),
    ("TH", "Nonthaburi Lab Services Co., Ltd.", "Independent lab", "S", "Nonthaburi", "QTS", "B", {}),
    ("TH", "Hat Yai Southern Hospital Co., Ltd.", "Private hospital", "M", "Hat Yai", "SPD", "ABC", {}),
    ("TH", "Ayutthaya Heritage Clinic Co., Ltd.", "Clinic group", "S", "Ayutthaya", "QTS", "B", {}),
    ("TH", "Bangkok Riverside Dental Clinic Co., Ltd.", "Clinic group", "S", "Bangkok", "QTS", "B", {"key": "N_BKKDENTAL"}),
    ("TH", "Phra Nakhon Medical Centre Co., Ltd.", "Private hospital", "L", "Bangkok", "SPD", "ABC", {}),
    ("TH", "Silom Diagnostic Centre Co., Ltd.", "Independent lab", "M", "Bangkok", "SPD", "AB", {}),
    ("TH", "Rama IV Heart Institute Co., Ltd.", "Private hospital", "M", "Bangkok", "SPD", "AB", {}),
    ("TH", "Isan Regional Hospital", "Public hospital", "L", "Udon Thani", "SPD", "ABC", {}),
    ("TH", "Chonburi Medical Laboratory Co., Ltd.", "Independent lab", "S", "Chonburi", "SPD", "A", {}),
    ("TH", "Korat Family Clinic Co., Ltd.", "Clinic group", "S", "Nakhon Ratchasima", "SPD", "AB", {}),
    ("TH", "Chao Phraya Women's Hospital Co., Ltd.", "Private hospital", "M", "Bangkok", "SPD", "AB", {}),
    ("TH", "Bang Na Research Institute", "Research institute", "M", "Samut Prakan", "QTS", "BC", {}),
    ("TH", "Rayong Industrial Clinic Co., Ltd.", "Clinic group", "S", "Rayong", "QTS", "B", {}),
    ("TH", "Lampang Medical Centre Co., Ltd.", "Private hospital", "S", "Lampang", "SPD", "AB", {}),
    ("TH", "Hua Hin Coastal Hospital Co., Ltd.", "Private hospital", "M", "Hua Hin", "SPD", "ABC", {}),
    # Vietnam
    ("VN", "Saigon Riverside Hospital JSC", "Private hospital", "L", "Ho Chi Minh City", "QTS", "ABC", {"key": "SAIGON", "c_boost": 2.2}),
    ("VN", "Hanoi Central Laboratory", "Independent lab", "M", "Hanoi", "SPD", "AB", {"key": "HANOI"}),
    ("VN", "Hanoi Central Hospital", "Public hospital", "L", "Hanoi", "SPD", "AB", {"key": "N_HANOIHOSP"}),
    ("VN", "Saigon Riverside Eye Clinic", "Clinic group", "S", "Ho Chi Minh City", "QTS", "B", {"key": "N_SAIGONEYE"}),
    ("VN", "Hue Heritage Clinic", "Clinic group", "S", "Hue", "QTS", "B", {"churn": ("2026-02", "2026-05")}),
    ("VN", "Da Nang Medical Laboratory JSC", "Independent lab", "S", "Da Nang", "SPD", "AB", {}),
    ("VN", "Hai Phong Port Medical Centre", "Private hospital", "M", "Hai Phong", "SPD", "AB", {}),
    ("VN", "Can Tho Mekong Hospital", "Private hospital", "L", "Can Tho", "SPD", "ABC", {"new": "2026-01-26", "c_boost": 2.0}),
    ("VN", "Binh Duong International Hospital", "Private hospital", "L", "Thu Dau Mot", "SPD", "ABC", {"new": "2026-04-20", "c_boost": 2.0}),
    ("VN", "Thu Duc Clinic Group JSC", "Clinic group", "S", "Ho Chi Minh City", "QTS", "B", {}),
    ("VN", "Long Bien Medical Centre", "Private hospital", "M", "Hanoi", "SPD", "AB", {}),
    ("VN", "Vinh Provincial Laboratory", "Independent lab", "S", "Vinh", "SPD", "A", {}),
    ("VN", "Quang Ninh Coastal Clinic", "Clinic group", "S", "Ha Long", "QTS", "B", {}),
    ("VN", "Saigon South Diagnostics JSC", "Independent lab", "M", "Ho Chi Minh City", "SPD", "AB", {}),
    ("VN", "Bien Hoa Medical Centre", "Private hospital", "S", "Bien Hoa", "SPD", "AB", {}),
    ("VN", "Mekong Delta Research Institute", "Research institute", "S", "Can Tho", "QTS", "B", {}),
]

# Duplicate records planted in the master, as another business entity created them.
#   products: which product's orders get booked to the duplicate record
#   from:     first month the duplicate is used ("always" = before the data period)
DUPLICATES = [
    dict(orig="NUH", name="Natl Univ Hosp", entity="QTS", created="2021-06-14", reg="blank",
         products="B", start="always", story="Cross-entity split: Lab supplies books all Product B orders to its own record"),
    dict(orig="KVSH", name="KVSH - Klang Valley Specialist Hosp. Sdn Bhd", entity="QTG", created="2026-06-08", reg="same",
         products="C", start="2026-07", story="Created again in Jun 2026; Product C orders moved to it from Jul"),
    dict(orig="SAIGON", name="Sai Gon Riverside International Hospital", entity="SPD", created="2026-06-22", reg="same",
         products="ABC", start="2026-07", story="Customer rebranded; sales requested a new account instead of updating the old one"),
    dict(orig="JOHOR", name="Johor Specialist Hosp", entity="QTS", created="2024-03-11", reg="blank", country="SG",
         products="B", start="always", story="Created by a Singapore team with country = Singapore, so Malaysian volume shows up in Singapore"),
    dict(orig="SURABAYA", name="RS Surabaya Medika", entity="QTG", created="2022-09-05", reg="typo",
         products="C", start="always", story="Cross-entity split with a mistyped tax number"),
    dict(orig="BKKRIVER", name="Bangkok Riverside Hosp", entity="SPD", created="2026-07-20", reg="same", address="new",
         products="ABC", start="2026-08", story="Purchasing office moved; a new account was opened at the new address"),
    dict(orig="PENANG", name="Penang Pathology Svcs", entity="SPD", created="2023-02-13", reg="blank",
         products="A", start="always", story="Cross-entity split: diagnostics books Product A to its own record"),
    dict(orig="CHIANGMAI", name="Chiangmai Clinical Lab", entity="QTS", created="2023-08-28", reg="same",
         products="B", start="always", story="Cross-entity split with a spelling variant"),
    dict(orig="HANOI", name="Ha Noi Central Lab JSC", entity="QTS", created="2026-02-16", reg="blank",
         products="B", start="2026-03", story="Created again in Feb 2026; Product B orders moved to it from Mar"),
    dict(orig="LIONCITY", name="Lion City Diagnostic Laboratory", entity="QTG", created="2022-01-17", reg="typo",
         products="C", start="always", story="Cross-entity split with a mistyped registration number"),
]

# Prospects whose account setup is still in flight on 30 Sep 2026 (pipeline)
PROSPECTS = [
    ("ID", "PT Rumah Sakit Semarang Diagnostika", "Private hospital", "M", "Semarang", "SPD", "AB", "2026-09-14"),
    ("ID", "PT Bekasi Lab Services", "Independent lab", "S", "Bekasi", "SPD", "AB", "2026-09-21"),
    ("ID", "PT Rumah Sakit Jakarta Utara", "Private hospital", "L", "Jakarta", "SPD", "ABC", "2026-09-08"),
    ("ID", "PT Depok Medika Clinic", "Clinic group", "S", "Depok", "QTS", "B", "2026-09-24"),
    ("ID", "PT Rumah Sakit Bogor Sehat", "Private hospital", "M", "Bogor", "SPD", "AB", "2026-09-16"),
    ("VN", "Da Nang Coastal Hospital", "Private hospital", "L", "Da Nang", "QTG", "ABC", "2026-09-10"),
    ("VN", "Nha Trang Bay Hospital", "Private hospital", "M", "Nha Trang", "SPD", "AB", "2026-09-22"),
    ("MY", "Kota Kinabalu Specialist Centre Sdn Bhd", "Private hospital", "M", "Kota Kinabalu", "SPD", "ABC", "2026-09-17"),
    ("MY", "Putrajaya Diagnostics Centre Sdn Bhd", "Independent lab", "S", "Putrajaya", "SPD", "AB", "2026-09-25"),
    ("SG", "Punggol Women's Clinic Pte Ltd", "Clinic group", "S", "Singapore", "SPD", "AB", "2026-09-23"),
    ("TH", "Phuket Andaman Hospital Co., Ltd.", "Private hospital", "M", "Phuket", "SPD", "ABC", "2026-09-11"),
]

STREETS = {
    "SG": ["Kent Ridge Crescent", "Novena Rise", "Seletar Road", "Orchard Boulevard", "Tampines Avenue 5",
           "Jurong West Street 61", "Woodlands Drive 17", "Clementi Avenue 3", "Queensway", "Bedok North Road",
           "Pasir Ris Drive 3", "Holland Avenue", "Stadium Road", "Changi Business Park Crescent", "Telok Ayer Street",
           "Tengah Garden Walk", "Punggol Field", "Bukit Timah Road", "Marina Boulevard", "Harbourfront Walk",
           "Science Park Drive", "Sentosa Gateway"],
    "MY": ["Jalan Tun Razak", "Jalan Ampang", "Jalan Sultan Ismail", "Jalan Burma", "Jalan Tebrau", "Jalan Gasing",
           "Jalan Raja Musa", "Jalan Pahang", "Jalan Bangsar", "Jalan Dato Onn", "Jalan Kota Laksamana", "Jalan Teknokrat 3"],
    "ID": ["Jl. Jend. Sudirman", "Jl. M.H. Thamrin", "Jl. Gatot Subroto", "Jl. Diponegoro", "Jl. Ahmad Yani",
           "Jl. Pemuda", "Jl. Gajah Mada", "Jl. Asia Afrika", "Jl. Pahlawan", "Jl. Raya Bogor", "Jl. Margonda Raya"],
    "TH": ["Sukhumvit Road", "Rama IV Road", "Silom Road", "Phahonyothin Road", "Charoen Krung Road",
           "Nimmanhaemin Road", "Mittraphap Road", "Pattaya Beach Road", "Petchkasem Road", "Bang Na-Trat Road"],
    "VN": ["Nguyen Hue Street", "Le Loi Street", "Tran Hung Dao Street", "Hai Ba Trung Street", "Ly Thuong Kiet Street",
           "Dien Bien Phu Street", "Vo Van Kiet Street", "Nguyen Van Linh Street", "Tran Phu Street"],
}
POSTCODE = {"SG": lambda: f"Singapore {rng.integers(100000, 829999)}", "MY": lambda: f"{rng.integers(10000, 98999)}",
            "ID": lambda: f"{rng.integers(10110, 99999)}", "TH": lambda: f"{rng.integers(10100, 96220)}", "VN": lambda: ""}
PHONE_PREFIX = {"SG": ("+65", "6"), "MY": ("+60", "3"), "ID": ("+62", "21"), "TH": ("+66", "2"), "VN": ("+84", "28")}


def make_address(country: str, city: str) -> str:
    n = int(rng.integers(1, 260))
    street = pick(STREETS[country])
    if country == "SG":
        return f"{n} {street}, {POSTCODE['SG']()}"
    if country == "MY":
        return f"{n}, {street}, {POSTCODE['MY']()} {city}, Malaysia"
    if country == "ID":
        return f"{street} No. {n}, {city} {POSTCODE['ID']()}, Indonesia"
    if country == "TH":
        return f"{n} {street}, {city} {POSTCODE['TH']()}, Thailand"
    return f"{n} {street}, {city}, Vietnam"


def make_phone(country: str) -> str:
    cc, area = PHONE_PREFIX[country]
    if country == "SG":
        return f"{cc} {area}{rng.integers(100, 999)} {rng.integers(1000, 9999)}"
    return f"{cc} {area} {rng.integers(1000, 9999)} {rng.integers(1000, 9999)}"


def reformat_phone(phone: str) -> str:
    """Same number, different formatting (how a second requestor typed it)."""
    digits = "".join(ch for ch in phone if ch.isdigit())
    return f"+{digits[:2]} {digits[2:]}"


def make_reg_no(country: str, year: int) -> str:
    if country == "SG":
        return f"{year}{rng.integers(10000, 99999)}{pick('KMNRWZDEGH')}"
    if country == "MY":
        return f"{year}01{rng.integers(100000, 999999)}"
    if country == "ID":
        d = rng.integers(0, 10, 15)
        s = "".join(map(str, d))
        return f"{s[0:2]}.{s[2:5]}.{s[5:8]}.{s[8]}-{s[9:12]}.{s[12:15]}"
    if country == "TH":
        return "0" + "".join(map(str, rng.integers(0, 10, 12)))
    return "0" + "".join(map(str, rng.integers(0, 10, 9)))


def typo(reg: str) -> str:
    """Change one digit, as a mistyped registration number."""
    idx = [i for i, ch in enumerate(reg) if ch.isdigit()]
    i = idx[len(idx) // 2]
    new = str((int(reg[i]) + 3) % 10)
    return reg[:i] + new + reg[i + 1:]


def slug_domain(name: str, country: str) -> str:
    words = [w for w in "".join(ch if ch.isalnum() or ch == " " else " " for ch in name.lower()).split()
             if w not in {"pt", "pte", "ltd", "sdn", "bhd", "co", "jsc", "the", "and", "rumah", "sakit"}]
    base = "".join(w[0] for w in words[:5]) if len(words) > 3 else "".join(words[:3])
    tld = {"SG": "com.sg", "MY": "com.my", "ID": "co.id", "TH": "co.th", "VN": "com.vn"}[country]
    return f"{base}.{tld}"


TERMS_BY_SEGMENT = {
    "Public hospital": ["Net 60", "Net 90"],
    "Private hospital": ["Net 30", "Net 60"],
    "Independent lab": ["Net 30", "Net 60"],
    "Clinic group": ["Net 30", "Cash in advance"],
    "Research institute": ["Net 30", "Net 60"],
}
CREDIT_BY_SIZE = {"L": (250_000, 600_000), "M": (80_000, 250_000), "S": (15_000, 60_000)}


def date_str(d: date | datetime) -> str:
    return d.strftime("%Y-%m-%d")


def build_customers():
    rows, by_key = [], {}
    for country, name, segment, size, city, entity, prods, extra in CUSTOMERS:
        if "new" in extra:
            created = None  # filled from the setup request simulation
        else:
            year = int(rng.integers(2010, 2024)) if size != "S" else int(rng.integers(2014, 2025))
            created = date(year, int(rng.integers(1, 13)), int(rng.integers(1, 28)))
        reg_year = (created.year if created else 2026) - int(rng.integers(0, 6))
        terms = pick(TERMS_BY_SEGMENT[segment])
        lo, hi = CREDIT_BY_SIZE[size]
        credit = 0 if terms == "Cash in advance" else int(round(rng.uniform(lo, hi), -3))
        row = dict(
            country=country, name=name, segment=segment, size=size, city=city, entity=entity,
            products=prods, created=created, reg_no=make_reg_no(country, reg_year),
            address=make_address(country, city), phone=make_phone(country),
            email=f"purchasing@{slug_domain(name, country)}", payment_terms=terms, credit_limit=credit,
            key=extra.get("key"), new_setup=extra.get("new"), churn=extra.get("churn"),
            c_boost=extra.get("c_boost", 1.0), is_duplicate=False, duplicate_of_key=None, story=None,
        )
        rows.append(row)
        if extra.get("key"):
            by_key[extra["key"]] = row
    return rows, by_key


def add_duplicates(rows, by_key):
    dups = []
    for d in DUPLICATES:
        o = by_key[d["orig"]]
        reg = {"same": o["reg_no"], "blank": "", "typo": typo(o["reg_no"])}[d["reg"]]
        if d.get("address") == "new":
            address = make_address(o["country"], o["city"])
            phone = make_phone(o["country"])
        else:
            # copied address with a different abbreviation style, as retyped by another team
            address = (o["address"].replace("Jalan", "Jln").replace("Road", "Rd").replace("Street", "St")
                       .replace("Avenue", "Ave").replace("Jl. ", "Jl "))
            phone = reformat_phone(o["phone"])
        row = dict(o)
        row.update(
            name=d["name"], entity=d["entity"], created=datetime.strptime(d["created"], "%Y-%m-%d").date(),
            reg_no=reg, address=address, phone=phone, country=d.get("country", o["country"]),
            key=f"DUP_{d['orig']}", new_setup=None, churn=None, is_duplicate=True,
            duplicate_of_key=d["orig"], story=d["story"], dup_products=d["products"], dup_start=d["start"],
        )
        dups.append(row)
        by_key[row["key"]] = row
    return rows + dups


# ---------------------------------------------------------------------------
# 2. Email-era MDM process model (used for history and for new-customer setups)
# ---------------------------------------------------------------------------
APPROVERS = {
    "Customer": lambda: ["Finance", "BU Head", "Business Support"] + (["Regional Director"] if rng.random() < 0.3 else []),
    "Item": lambda: (["Quality/Regulatory"] if rng.random() < 0.6 else []) + ["BU Head", "Business Support"],
    "Vendor": lambda: ["Procurement", "Finance"] + (["Quality/Regulatory"] if rng.random() < 0.4 else []),
    "Cost centre": lambda: ["Finance", "BU Head"],
}


def simulate_email_request(domain: str, submitted: datetime, approvers=None):
    """One request through today's email process. Returns steps and timings (calendar days)."""
    approvers = approvers or APPROVERS[domain]()
    if rng.random() < 0.10:
        approvers = approvers + ["Country Manager"]
    t = submitted
    steps = []
    triage = float(lognormal(1.3, 0.9))
    t += timedelta(days=triage)
    steps.append(dict(step="MDM forwards request", done=t))
    bounces = 0
    if rng.random() < 0.40:  # incomplete form bounced back to the requestor
        bounces += 1
        t += timedelta(days=float(lognormal(4.0, 3.0)) + 0.5)
        steps.append(dict(step="Requestor supplies missing fields", done=t))
        if rng.random() < 0.12:
            bounces += 1
            t += timedelta(days=float(lognormal(3.0, 2.0)))
            steps.append(dict(step="Requestor supplies missing fields (again)", done=t))
    clarifications = 0
    for role in approvers:  # sequential: each approver has to notice the email
        sent = t
        t += timedelta(days=float(lognormal(4.6, 3.6)))
        if rng.random() < 0.15:
            clarifications += 1
            t += timedelta(days=float(lognormal(2.5, 1.5)))
        steps.append(dict(step=f"{role} approves", sent=sent, done=t))
    t += timedelta(days=float(lognormal(1.5, 1.0)))
    steps.append(dict(step="MDM keys record into SAP B1", done=t))
    return dict(approvers=approvers, steps=steps, completed=t, bounces=bounces, clarifications=clarifications)


# ---------------------------------------------------------------------------
# 3. Items, vendors, cost centres
# ---------------------------------------------------------------------------
MANUFACTURERS = ["Meridian Dx", "Sorell Biotech", "Kanto Assay Systems", "Lumen Diagnostics", "Nordic Labware",
                 "Pacifica Medical", "Arden Instruments", "Helix Lab Supplies", "Tanaka Medical"]
ITEMS = {
    "A": [  # (description, category, uom, price factor, storage)
        ("HbA1c Reagent Kit, 100 tests", "IVD reagent", "kit", 1.10, "2-8 °C"),
        ("TSH Immunoassay Kit, 200 tests", "IVD reagent", "kit", 1.35, "2-8 °C"),
        ("CRP Reagent, 4 x 50 mL", "IVD reagent", "kit", 0.70, "2-8 °C"),
        ("High-Sensitivity Troponin I Assay, 100 tests", "IVD reagent", "kit", 1.60, "2-8 °C"),
        ("Glucose Reagent, 4 x 100 mL", "IVD reagent", "kit", 0.55, "Ambient"),
        ("Lipid Panel Calibrator Set", "IVD reagent", "kit", 0.85, "2-8 °C"),
        ("Ferritin Immunoassay Kit, 100 tests", "IVD reagent", "kit", 1.20, "2-8 °C"),
        ("Vitamin D Total Assay, 100 tests", "IVD reagent", "kit", 1.45, "2-8 °C"),
        ("Procalcitonin Assay Kit, 50 tests", "IVD reagent", "kit", 1.55, "2-8 °C"),
        ("Creatinine Enzymatic Reagent, 4 x 60 mL", "IVD reagent", "kit", 0.65, "2-8 °C"),
        ("ALT/AST Reagent Pack, 2 x 100 tests", "IVD reagent", "kit", 0.75, "2-8 °C"),
        ("Dengue NS1 Rapid Test, 25 tests", "IVD reagent", "kit", 0.90, "Ambient"),
        ("COVID-19/Flu A+B Antigen Rapid Test, 25 tests", "IVD reagent", "kit", 0.80, "Ambient"),
        ("Hematology Control, 3 levels", "IVD reagent", "kit", 0.95, "2-8 °C"),
        ("Coagulation PT Reagent, 10 x 4 mL", "IVD reagent", "kit", 1.05, "2-8 °C"),
        ("Urinalysis Test Strips, 100 strips", "IVD reagent", "kit", 0.40, "Ambient"),
        ("D-Dimer Immunoassay, 100 tests", "IVD reagent", "kit", 1.30, "2-8 °C"),
        ("HbA1c RGT KIT 100T", "IVD reagent", "kit", 1.10, "2-8 °C"),  # near-duplicate of the first item
    ],
    "B": [
        ("Vacuum Blood Collection Tube, EDTA 4 mL, 100/box", "Lab consumable", "box", 0.80, ""),
        ("Vacuum Blood Collection Tube, Serum 5 mL, 100/box", "Lab consumable", "box", 0.85, ""),
        ("Pipette Tips, 200 uL, 1000/box", "Lab consumable", "box", 0.60, ""),
        ("Pipette Tips, 1000 uL, 1000/box", "Lab consumable", "box", 0.70, ""),
        ("Specimen Container, 60 mL, 500/case", "Lab consumable", "case", 2.10, ""),
        ("Nitrile Examination Gloves, Medium, 100/box", "Lab consumable", "box", 0.45, ""),
        ("Nitrile Examination Gloves, Large, 100/box", "Lab consumable", "box", 0.45, ""),
        ("Microscope Slides, Frosted, 72/box", "Lab consumable", "box", 0.55, ""),
        ("Cryovials, 2 mL, 500/case", "Lab consumable", "case", 1.80, ""),
        ("Centrifuge Tubes, 15 mL, 500/case", "Lab consumable", "case", 1.50, ""),
        ("Urine Collection Cups, Sterile, 100/box", "Lab consumable", "box", 0.65, ""),
        ("Safety Lancets, 21G, 200/box", "Lab consumable", "box", 0.75, ""),
        ("Biohazard Bags, Large, 100/box", "Lab consumable", "box", 0.50, ""),
        ("Swab Collection Kit with VTM, 50/box", "Lab consumable", "box", 1.90, ""),
        ("PCR Plates, 96-well, 50/box", "Lab consumable", "box", 2.40, ""),
        ("Sample Cups for Analyzers, 1000/box", "Lab consumable", "box", 0.90, ""),
        ("Cuvettes, Semi-micro, 500/box", "Lab consumable", "box", 1.10, ""),
        ("Gloves Nitrile Exam M (100s)", "Lab consumable", "box", 0.45, ""),  # near-duplicate
    ],
    "C": [
        ("Chemistry Analyzer Preventive Maintenance Visit", "Service", "visit", 0.55, ""),
        ("Hematology Analyzer Service Contract, monthly", "Service", "month", 0.70, ""),
        ("Immunoassay Analyzer Calibration Visit", "Service", "visit", 0.45, ""),
        ("Benchtop Centrifuge, 24-place", "Instrument", "unit", 2.40, ""),
        ("Biosafety Cabinet Certification", "Service", "visit", 0.35, ""),
        ("Point-of-Care HbA1c Analyzer", "Medical device", "unit", 3.20, ""),
        ("Blood Gas Analyzer Cartridge Service, monthly", "Service", "month", 0.80, ""),
        ("Laboratory Refrigerator, 2-8 °C, 400 L", "Instrument", "unit", 2.80, ""),
        ("Coagulation Analyzer Service Contract, monthly", "Service", "month", 0.65, ""),
        ("Urine Analyzer, Semi-automated", "Medical device", "unit", 2.20, ""),
        ("Analyzer Interface Integration (LIS)", "Service", "visit", 1.40, ""),
        ("Centrifuge Rotor, 24 Place", "Instrument", "unit", 0.60, ""),
    ],
}
ITEM_DUPLICATES = {"HbA1c RGT KIT 100T": "HbA1c Reagent Kit, 100 tests",
                   "Gloves Nitrile Exam M (100s)": "Nitrile Examination Gloves, Medium, 100/box"}


def build_items():
    rows = []
    for line, specs in ITEMS.items():
        base = PRODUCTS[line]["price"]
        for i, (desc, cat, uom, factor, storage) in enumerate(specs, start=1):
            code = f"{line}-{1000 + i}"
            mfr = pick(MANUFACTURERS)
            part = f"{mfr.split()[0][:3].upper()}-{rng.integers(10000, 99999)}"
            regulated = cat in ("IVD reagent", "Medical device")
            created = date(int(rng.integers(2016, 2025)), int(rng.integers(1, 13)), int(rng.integers(1, 28)))
            rows.append(dict(item_code=code, description=desc, product_line=line, category=cat, uom=uom,
                             manufacturer=mfr, mfr_part_no=part,
                             licence_no=(f"DE{rng.integers(1000000, 9999999)}" if regulated else ""),
                             storage=storage, list_price=round(base * factor, 2),
                             entity=PRODUCTS[line]["entity"], created=created, is_duplicate=False, duplicate_of=""))
    by_desc = {r["description"]: r for r in rows}
    for dup_desc, orig_desc in ITEM_DUPLICATES.items():
        d, o = by_desc[dup_desc], by_desc[orig_desc]
        d.update(manufacturer=o["manufacturer"], mfr_part_no=o["mfr_part_no"], licence_no=o["licence_no"],
                 created=date(2025, 3, 18) if d["product_line"] == "A" else date(2024, 11, 4),
                 entity="QTS" if d["product_line"] == "A" else "SPD", is_duplicate=True, duplicate_of=o["item_code"])
    return rows


VENDORS = [
    ("Meridian Dx Inc.", "US", "Product principal / manufacturer"),
    ("Sorell Biotech GmbH", "DE", "Product principal / manufacturer"),
    ("Kanto Assay Systems K.K.", "JP", "Product principal / manufacturer"),
    ("Lumen Diagnostics Ltd", "GB", "Product principal / manufacturer"),
    ("Nordic Labware AB", "SE", "Product principal / manufacturer"),
    ("Pacifica Medical Pty Ltd", "AU", "Product principal / manufacturer"),
    ("Arden Instruments Inc.", "US", "Product principal / manufacturer"),
    ("Helix Lab Supplies Co., Ltd.", "CN", "Product principal / manufacturer"),
    ("Tanaka Medical Co., Ltd.", "JP", "Product principal / manufacturer"),
    ("SwiftChain Logistics Pte Ltd", "SG", "Logistics"),
    ("ColdLink Asia Sdn Bhd", "MY", "Logistics"),
    ("Nusantara Cold Chain PT", "ID", "Logistics"),
    ("Siam Express Freight Co., Ltd.", "TH", "Logistics"),
    ("Mekong Distribution JSC", "VN", "Logistics"),
    ("Calibra Metrology Services Pte Ltd", "SG", "Service provider"),
    ("BioSafe Certification Sdn Bhd", "MY", "Service provider"),
    ("LabTech Field Engineers Co., Ltd.", "TH", "Service provider"),
    ("Precision Biomedical Repairs PT", "ID", "Service provider"),
    ("Harbour Packaging Pte Ltd", "SG", "Other"),
    ("Orchid Office Supplies Sdn Bhd", "MY", "Other"),
    ("Clinical IT Solutions Pte Ltd", "SG", "Service provider"),
    ("Saigon Biomedical Services Co., Ltd.", "VN", "Service provider"),
]
VENDOR_DUPLICATES = [("Swift Chain Logistics", "SwiftChain Logistics Pte Ltd"),
                     ("Nordic Labware Aktiebolag", "Nordic Labware AB")]
BANKS = {"SG": ("Straits Commercial Bank", "SCBKSGSG"), "MY": ("Peninsula Trust Bank", "PTBKMYKL"),
         "ID": ("Nusantara Raya Bank", "NRBKIDJA"), "TH": ("Chao Phraya Bank", "CPBKTHBK"),
         "VN": ("Red River Bank", "RRBKVNVX"), "US": ("Atlantic Union Bank", "AUBKUS33"),
         "DE": ("Rhein Handelsbank", "RHBKDEFF"), "JP": ("Kanto Commercial Bank", "KCBKJPJT"),
         "GB": ("Thames Merchant Bank", "TMBKGB2L"), "SE": ("Baltic Nordic Bank", "BNBKSESS"),
         "AU": ("Southern Cross Bank", "SCRBAU2S"), "CN": ("Pearl River Bank", "PRBKCNSH")}


def build_vendors():
    rows = []
    for i, (name, country, vtype) in enumerate(VENDORS, start=1):
        bank, swift = BANKS[country]
        rows.append(dict(vendor_code=f"V-{2000 + i}", name=name, country=country, vendor_type=vtype,
                         reg_no=f"{country}{rng.integers(10_000_000, 99_999_999)}", bank_name=bank,
                         bank_account="".join(map(str, rng.integers(0, 10, 12))), swift=swift,
                         payment_terms=pick(["Net 30", "Net 45", "Net 60"]),
                         created=date(int(rng.integers(2012, 2025)), int(rng.integers(1, 13)), int(rng.integers(1, 28))),
                         is_duplicate=False, duplicate_of=""))
    by_name = {r["name"]: r for r in rows}
    for j, (dup_name, orig_name) in enumerate(VENDOR_DUPLICATES):
        o = by_name[orig_name]
        rows.append(dict(o, vendor_code=f"V-{2100 + j}", name=dup_name, reg_no="",
                         created=date(2024, 5 + j * 4, 9), is_duplicate=True, duplicate_of=o["vendor_code"]))
    return rows


def build_cost_centres():
    specs = [("SPD", "SG", "SALES", "Sales"), ("SPD", "MY", "SALES", "Sales"), ("SPD", "ID", "SALES", "Sales"),
             ("SPD", "TH", "SALES", "Sales"), ("SPD", "VN", "SALES", "Sales"), ("SPD", "SG", "MKT", "Marketing"),
             ("QTS", "SG", "SALES", "Sales"), ("QTS", "MY", "SALES", "Sales"), ("QTS", "SG", "WH", "Warehouse"),
             ("QTS", "MY", "WH", "Warehouse"), ("QTG", "SG", "SVC", "Field service"), ("QTG", "MY", "SVC", "Field service"),
             ("QTG", "TH", "SVC", "Field service"), ("QTG", "VN", "SVC", "Field service"), ("QTG", "SG", "SALES", "Sales"),
             ("GRP", "SG", "FIN", "Group finance"), ("GRP", "SG", "IT", "Group IT"), ("GRP", "SG", "MDM", "Master data")]
    owners = ["Wei Jie", "Daniel", "Mei Ling", "Arjun", "Grace", "Priya", "Hafiz"]
    return [dict(code=f"CC-{e}-{c}-{f}", name=f"{e} {label} - {COUNTRIES[c]}", entity=e, country=c,
                 owner=pick(owners), valid_from=f"{rng.integers(2016, 2025)}-01-01")
            for e, c, f, label in specs]


# ---------------------------------------------------------------------------
# 4. Purchase orders
# ---------------------------------------------------------------------------
TREND = {  # monthly growth factor for existing customers, by country and product
    "SG": {"A": 1.002, "B": 1.000, "C": 1.004},
    "MY": {"A": 1.008, "B": 1.018, "C": 1.006},
    "ID": {"A": 1.012, "B": 1.012, "C": 1.010},
    "TH": {"A": 0.998, "B": 0.990, "C": 1.000},
    "VN": {"A": 1.010, "B": 1.008, "C": 1.030},
}
BASE = {  # units per month range by product and size
    "A": {"L": (140, 260), "M": (45, 110), "S": (10, 35)},
    "B": {"L": (500, 1100), "M": (150, 380), "S": (30, 110)},
    "C": {"L": (2.5, 5.0), "M": (1.0, 2.5), "S": (0.3, 0.9)},
}
NOISE = {"L": 0.12, "M": 0.20, "S": 0.30}


def seasonality(country: str, month_idx: int, segment: str) -> float:
    m = MONTHS[month_idx]
    f = 1.0
    if m == "2025-12":
        f *= 0.94  # year-end holidays
    if m == "2026-01" and country == "VN":
        f *= 1.08  # stocking up before Tet
    if m == "2026-02":
        f *= {"SG": 0.93, "MY": 0.93, "VN": 0.80, "ID": 0.97, "TH": 0.98}[country]  # Lunar New Year / Tet
    if m == "2026-03":
        if country in ("ID", "MY"):
            f *= 0.92  # Ramadan and Hari Raya
        if country == "SG" and segment == "Public hospital":
            f *= 1.06  # financial-year-end budget use
    if m == "2026-04":
        if country == "TH":
            f *= 0.88  # Songkran
        if country in ("ID", "MY"):
            f *= 1.04  # post-Raya restocking
    return f


def month_index(ym: str) -> int:
    return MONTHS.index(ym) if ym in MONTHS else (-1 if ym < MONTHS[0] else 99)


def random_day(ym: str, earliest: date | None = None) -> date:
    y, m = map(int, ym.split("-"))
    last = (date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1)).day
    lo = earliest.day if earliest and (earliest.year, earliest.month) == (y, m) else 1
    lo = min(lo, last)
    for _ in range(60):
        d = date(y, m, int(rng.integers(lo, last + 1)))
        if d.weekday() < 5:
            return d
    return date(y, m, last)


def build_orders(customers, items):
    item_by_line = {line: [r for r in items if r["product_line"] == line and not r["is_duplicate"]] for line in "ABC"}
    dup_of = {c["duplicate_of_key"]: c for c in customers if c["is_duplicate"]}
    orders = []
    po_seq = 0
    for c in customers:
        if c["is_duplicate"]:
            continue
        first_m = month_index(c["first_order_month"]) if c.get("first_order_month") else 0
        churn = c.get("churn")
        for line in c["products"]:
            lo, hi = BASE[line][c["size"]]
            mu = rng.uniform(lo, hi) * (c["c_boost"] if line == "C" else 1.0)
            trend = TREND[c["country"]][line] + rng.normal(0, 0.004)
            prefer = [pick(item_by_line[line]) for _ in range(2)]
            cadence = 1 if c["size"] == "L" else (1 if c["size"] == "M" else int(rng.choice([1, 2, 3], p=[0.3, 0.4, 0.3])))
            phase = int(rng.integers(0, cadence))
            carry = 0.0
            for mi, ym in enumerate(MONTHS):
                if mi < first_m:
                    continue
                demand = mu * trend ** mi * seasonality(c["country"], mi, c["segment"])
                demand *= float(np.exp(rng.normal(-NOISE[c["size"]] ** 2 / 2, NOISE[c["size"]])))
                if c.get("first_order_month"):
                    age = mi - first_m
                    demand *= [0.5, 0.75][age] if age < 2 else 1.0
                if churn:
                    s, last = month_index(churn[0]), month_index(churn[1])
                    if mi > last:
                        demand = 0.0
                    elif mi >= s:
                        demand *= 1 - 0.7 * (mi - s) / max(1, last - s)
                carry += demand
                order_now = (mi - phase) % cadence == 0
                if c["size"] == "M" and rng.random() < 0.12:
                    order_now = False
                if churn and mi > month_index(churn[1]):
                    order_now, carry = False, 0.0
                if not order_now:
                    continue
                qty = int(round(carry))
                if qty < 1:
                    continue
                carry -= qty
                splits = 2 if (c["size"] == "L" and line != "C" and rng.random() < 0.25) else 1
                parts = [qty] if splits == 1 else [qty // 2, qty - qty // 2]
                # which customer record the selling entity books the order to
                booked = c
                dup = dup_of.get(c["key"]) if c["key"] else None
                if dup and line in dup["dup_products"]:
                    if dup["dup_start"] == "always" or ym >= dup["dup_start"]:
                        booked = dup
                for q in parts:
                    if q < 1:
                        continue
                    po_seq += 1
                    item = pick(prefer)
                    d = random_day(ym, c.get("first_order_date") if mi == first_m else None)
                    orders.append(dict(
                        po_id=f"PO-{d:%y%m}-{po_seq:05d}", po_date=d, month=ym, customer_id=booked["customer_id"],
                        true_customer_id=c["customer_id"], country=booked["country"], entity=PRODUCTS[line]["entity"],
                        product=line, item_code=item["item_code"], qty=q, unit_price=item["list_price"],
                        value_sgd=round(q * item["list_price"], 2),
                        customer_po_ref=f"{pick(['45', '47', 'PO', 'LG'])}{rng.integers(100000, 999999)}",
                    ))
    return orders


# ---------------------------------------------------------------------------
# 5. Inbound messages (shared mailbox)
# ---------------------------------------------------------------------------
FIRST = ["Aisha", "Benjamin", "Chen Wei", "Dewi", "Eko", "Farah", "Gan", "Hui Min", "Indra", "Jun", "Kanya", "Linh",
         "Minh", "Nur", "Owen", "Putri", "Quan", "Rizal", "Siti", "Thanh", "Uma", "Vikram", "Wan", "Yusuf", "Zhi Hao",
         "Somchai", "Pim", "Arif", "Mei", "Hafsah"]
GREET = {"SG": ["Hi", "Dear team", "Hello", "Good morning"], "MY": ["Hi", "Dear team", "Selamat pagi", "Good morning"],
         "ID": ["Selamat pagi", "Dear team", "Hi", "Halo"], "TH": ["Sawasdee krub", "Dear team", "Hello", "Hi"],
         "VN": ["Xin chao", "Dear team", "Hello", "Hi"]}
ANALYSERS = ["Cobas", "Architect", "AU680", "Dimension", "Atellica", "DxC 700", "Mindray BS-800"]


def sign(country):
    return f"{pick(FIRST)}\n{pick(['Procurement', 'Purchasing', 'Lab Manager', 'Store', 'Supply Chain'])}"


def msg_order(o, cust, item):
    g = pick(GREET[o["country"]])
    q, u, it, ref = o["qty"], item["uom"], item["description"], o["customer_po_ref"]
    subj = pick([f"PO {ref} - {it}", f"Purchase Order {ref}", f"New PO {ref}", f"Order: {q} x {it}", f"PO#{ref}",
                 f"{cust['name']} purchase order {ref}", f"Replenishment order - {it}", f"Monthly order {o['month']}"])
    body = pick([
        f"{g},\n\nPlease find attached our purchase order {ref} for {q} {u} of {it}. Kindly deliver to our main store by next week.\n\nRegards,\n{sign(o['country'])}",
        f"{g},\nPO {ref} attached. Qty {q} {u} - {it}. Please confirm the delivery date.\nThanks,\n{sign(o['country'])}",
        f"{g},\nWe would like to order {q} {u} of {it} (cat. {item['item_code']}) under PO {ref}. Delivery to the usual address.\n\n{sign(o['country'])}",
        f"Please process the attached PO {ref} ({q} {u}, {it}) and send the order acknowledgement.\nBest regards,\n{sign(o['country'])}",
        f"{g}, this month's replenishment: PO {ref} for {q} {u} {it}. Same delivery address as usual. Thank you.",
        f"{g},\nKindly arrange supply of {it}, quantity {q} {u}. Our PO number is {ref}. Invoice to {cust['name']}.\nThank you,\n{sign(o['country'])}",
        f"{g}, attaching PO {ref}. {q} {u} of {it} please, partial delivery is fine.\n{sign(o['country'])}",
        f"{g}, please supply {q} {u} of {it} to our lab by Friday. Thanks.\n{sign(o['country'])}",
        f"{g}, kindly send {q} {u} {it}, same as last month. Thank you.",
        f"{g},\nOur order form is attached: {it} x {q} {u}. Please deliver to the lab store.\n{sign(o['country'])}",
    ])
    if rng.random() < 0.06:
        subj, body = pick(["Documents", "For your action", "Attached", "Order"]), pick(["Please see attached.", "See attachment, thanks.", "Attached for your processing."])
    return subj, body


def msg_enquiry(country, org, item):
    g = pick(GREET[country])
    it = item["description"]
    subj = pick([f"Price enquiry - {it}", f"Quotation request: {it}", f"Lead time for {it}?", f"Question on {it}",
                 "Request for product information", f"Availability of {it}", "Pricing for 2027", f"Demo request - {it}",
                 f"RFQ - {it}"])
    body = pick([
        f"{g}, could you share your best price and lead time for {int(rng.integers(5, 300))} {item['uom']} of {it}? We are planning our budget for next quarter.",
        f"{g},\nIs {it} compatible with our {pick(ANALYSERS)} analyser? Please send the IFU and technical datasheet.\nThanks",
        f"{g}, we are evaluating suppliers for {it}. Kindly send a quotation including delivery to our site.\n\nRegards,\n{org}",
        f"{g}, can you advise the current stock availability for {it}? We may need it next month.",
        f"{g}, do you have a cheaper alternative to {it}? Please advise options and pricing.",
        f"{g},\nWe'd like a product demo of {it} for our lab team. What dates are available?\n{pick(FIRST)}",
        f"{g}, please send the updated price list for 2027 and any volume discounts.",
        f"{g}, what is the shelf life and storage requirement for {it}? Need this for our evaluation.",
        f"{g}, before we place our order, can you confirm the price of {it}?",
        f"{g}, we plan to order about {int(rng.integers(10, 200))} {item['uom']} of {it} next month. What is the lead time?",
        f"{g}, could you check if you have {it} in stock? If yes we will send a PO.",
        f"{g}, please send a quote for {it}. We need it for our purchase order approval.",
    ])
    return subj, body


def msg_setup(country, org, kind, item=None, address=None):
    g = pick(GREET[country])
    if kind == "account":
        subj = pick([f"New customer account opening - {org}", "Account registration request",
                     "Please set up our company as a new customer", f"Open account for {org}", "Customer onboarding documents"])
        body = pick([
            f"{g},\nWe are {org} and would like to open a customer account to start ordering from you. Please let us know the documents required (business registration, billing address, tax details).\nRegards,\n{pick(FIRST)}",
            f"{g}, attached are our business registration certificate and billing details for account opening. We hope to place our first order soon.",
            f"Hi MDM team, please set up {org} as a new customer. They want to place a first order next week. Registration documents attached.\n{pick(FIRST)}, Sales",
            f"{g}, kindly register {org} in your system as a customer. Our finance contact and bank reference letter are attached.",
            f"{g}, we'd like to place our first order with you, but we understand we need an account first. Please advise.",
            f"{g}, please find our company documents attached so you can create our account before our first purchase order.",
        ])
        if rng.random() < 0.12:
            subj, body = pick(["Documents", "For your action", "Attached"]), pick(["Please see attached.", "Attached as requested.", "Documents attached, thank you."])
    elif kind == "shipto":
        subj = pick([f"New ship-to address - {org}", "Add delivery location", "New delivery address for our lab"])
        body = f"{g}, please add a new delivery address for {org}: {address}. Our new lab opens next month."
    elif kind == "item":
        subj = pick([f"New item code needed - {item}", "Please create item code", f"Item setup: {item}"])
        body = pick([f"Hi team, customer {org} wants to order {item} which we don't carry yet. Please create a new item code so we can quote.",
                     f"{g}, please register {item} as a new product code. Registration certificate attached; the customer is ready to order."])
    else:  # change of details
        subj = pick(["Change of billing address", "Update of company details", "Change of company name"])
        body = f"{g}, our billing address has changed to {address}. Please update your records before the next invoice.\nRegards,\n{org}"
    return subj, body


def msg_followup(country, ref=None, kind="order", item=None):
    g = pick(GREET[country])
    if kind == "order":
        subj = pick([f"Re: PO {ref}", f"Status of order {ref}", f"Reminder - PO {ref}", "Any update?", f"RE: Purchase Order {ref}"])
        body = pick([f"{g}, any update on PO {ref}? We haven't received the order confirmation yet.",
                     f"Gentle reminder: please confirm the delivery date for PO {ref}.",
                     f"{g}, could you check the status of our order {ref}? Our stock is running low.",
                     f"{g}, we have not received the goods for PO {ref}. Please advise the tracking number.",
                     f"{g}, did you receive our order? We sent it last week but have no confirmation.",
                     f"{g}, when will our order arrive? The lab is running low."])
    elif kind == "setup":
        subj = pick(["Follow up: account opening", "Re: Account registration request", "Any update on our account?"])
        body = pick([f"{g}, following up on our account opening request from last week. Is the account ready?",
                     f"{g}, we still cannot place orders because our account is not set up. Please advise the status.",
                     f"Chasing again on the new customer setup - the customer is waiting to order."])
    else:
        subj = pick(["RE: Quotation request", "Re: Price enquiry", "Following up on my question"])
        body = pick([f"{g}, still waiting for the quotation I requested. Please advise.",
                     f"Hello again, any update on my enquiry about {item}?",
                     f"{g}, we need the price for {item} before we can raise our PO. Any update?"])
    return subj, body


def add_typos(text: str) -> str:
    chars = list(text)
    for i in range(len(chars)):
        if chars[i].isalpha() and rng.random() < 0.02:
            chars[i] = chars[i - 1] if i else chars[i]
    return "".join(chars)


def build_messages(customers, orders, items, prospects_rows):
    cust_by_id = {c["customer_id"]: c for c in customers}
    item_by_code = {i["item_code"]: i for i in items}
    all_items = [i for i in items if not i["is_duplicate"]]
    msgs = []

    def add(dt_, country, cust_id, org, subj, body, mtype, po=None, link=None):
        if rng.random() < 0.10:
            body = add_typos(body)
        if rng.random() < 0.15:
            subj = subj.lower()
        msgs.append(dict(received_at=dt_, country=country, customer_id=cust_id or "", sender_org=org,
                         subject=subj, body=body, true_type=mtype, linked_po=po or "", linked_ref=link or ""))

    def stamp(d: date) -> datetime:
        return datetime(d.year, d.month, d.day, int(rng.integers(7, 19)), int(rng.integers(0, 60)))

    for o in orders:
        cust = cust_by_id[o["customer_id"]]
        item = item_by_code[o["item_code"]]
        when = stamp(o["po_date"] - timedelta(days=int(rng.integers(0, 3))))
        if rng.random() < 0.035:  # ambiguous: order plus a question
            other = pick(all_items)
            subj = f"PO {o['customer_po_ref']} + quick question"
            body = (f"{pick(GREET[o['country']])}, PO {o['customer_po_ref']} attached for {o['qty']} {item['uom']} of "
                    f"{item['description']}. Also, could you quote for {other['description']}?")
        else:
            subj, body = msg_order(o, cust, item)
        add(when, o["country"], o["customer_id"], cust["name"], subj, body, "purchase_order", po=o["po_id"])
        if rng.random() < 0.20:
            later = stamp(o["po_date"] + timedelta(days=int(rng.integers(3, 12))))
            if rng.random() < 0.05:  # ambiguous: follow-up that amends the order
                subj = f"Re: PO {o['customer_po_ref']}"
                body = f"Further to PO {o['customer_po_ref']}, please add {int(rng.integers(5, 40))} more {item['uom']} to this order and deliver together."
                add(later, o["country"], o["customer_id"], cust["name"], subj, body, "purchase_order", po=o["po_id"])
            else:
                subj, body = msg_followup(o["country"], o["customer_po_ref"])
                add(later, o["country"], o["customer_id"], cust["name"], subj, body, "follow_up", po=o["po_id"])

    # enquiries from active customers
    active = {}
    for o in orders:
        active.setdefault(o["customer_id"], set()).add(o["month"])
    lam = {"L": 0.9, "M": 0.45, "S": 0.2}
    for cid, months in active.items():
        c = cust_by_id[cid]
        for ym in MONTHS:
            if ym not in months and rng.random() < 0.6:
                continue
            for _ in range(rng.poisson(lam[c["size"]])):
                d = random_day(ym)
                subj, body = msg_enquiry(c["country"], c["name"], pick(all_items))
                add(stamp(d), c["country"], cid, c["name"], subj, body, "enquiry")
                if rng.random() < 0.12:
                    subj, body = msg_followup(c["country"], kind="quote", item=pick(all_items)["description"])
                    add(stamp(d + timedelta(days=int(rng.integers(4, 10)))), c["country"], cid, c["name"], subj, body, "follow_up")

    # setup requests: new customers and prospects (account opening), plus ship-to, item codes, changes
    new_accounts = [c for c in customers if c.get("setup_submitted")]
    for c in new_accounts:
        sub = c["setup_submitted"]
        for k in range(int(rng.integers(1, 3))):  # pre-setup enquiries
            d = sub - timedelta(days=int(rng.integers(5, 40)))
            subj, body = msg_enquiry(c["country"], c["name"], pick(all_items))
            add(stamp(d), c["country"], "", c["name"], subj, body, "enquiry", link=c["customer_id"])
        subj, body = msg_setup(c["country"], c["name"], "account")
        add(stamp(sub), c["country"], "", c["name"], subj, body, "setup_request", link=c["customer_id"])
        if rng.random() < 0.7:
            subj, body = msg_followup(c["country"], kind="setup")
            add(stamp(sub + timedelta(days=int(rng.integers(6, 14)))), c["country"], "", c["name"], subj, body, "follow_up", link=c["customer_id"])
    for p in prospects_rows:
        sub = p["setup_submitted"]
        for k in range(int(rng.integers(1, 4))):
            d = sub - timedelta(days=int(rng.integers(5, 45)))
            subj, body = msg_enquiry(p["country"], p["name"], pick(all_items))
            add(stamp(d), p["country"], "", p["name"], subj, body, "enquiry", link=p["prospect_id"])
        if rng.random() < 0.35:  # ambiguous: quote request + account opening
            subj = "Quotation and account opening"
            body = (f"{pick(GREET[p['country']])}, please quote {int(rng.integers(20, 200))} boxes of "
                    f"{pick(all_items)['description']} and let us know what you need to open our account.")
        else:
            subj, body = msg_setup(p["country"], p["name"], "account")
        add(stamp(sub), p["country"], "", p["name"], subj, body, "setup_request", link=p["prospect_id"])
        if (AS_OF - sub).days > 10 and rng.random() < 0.8:
            subj, body = msg_followup(p["country"], kind="setup")
            add(stamp(sub + timedelta(days=int(rng.integers(7, 12)))), p["country"], "", p["name"], subj, body, "follow_up", link=p["prospect_id"])
    real = [c for c in customers if not c["is_duplicate"]]
    for _ in range(150):
        c = pick(real)
        ym = pick(MONTHS)
        kind = pick(["shipto", "item", "item", "change"])
        if kind == "item":
            subj, body = msg_setup(c["country"], c["name"], "item", item=pick(["Anti-Mullerian Hormone assay", "NT-proBNP rapid test",
                                                                                 "Lactate reagent", "Syphilis rapid test",
                                                                                 "Sterile transport swabs", "HPV collection kit"]))
        else:
            subj, body = msg_setup(c["country"], c["name"], kind, address=make_address(c["country"], c["city"]))
        add(stamp(random_day(ym)), c["country"], c["customer_id"], c["name"], subj, body, "setup_request")
        if rng.random() < 0.06:  # ambiguous: follow-up phrased around an order
            subj = "Is our account updated yet?"
            body = f"Hi, is our account updated yet? We want to order {int(rng.integers(10, 80))} more boxes once it is done."
            add(stamp(random_day(ym)), c["country"], c["customer_id"], c["name"], subj, body, "follow_up")

    # mixed-intent messages: the same kind of wording turns up under more than one label in real mailboxes
    mixed = [
        ("We would like {q} {u} of {it}. Please send pricing and the delivery date.", "Order and price", {"purchase_order": 0.5, "enquiry": 0.5}),
        ("Please confirm our order for {it}.", "Our order", {"follow_up": 0.5, "purchase_order": 0.5}),
        ("Attached are our company documents and our first order for {q} {u} {it}.", "Documents and order", {"setup_request": 0.5, "purchase_order": 0.5}),
        ("Any update? We are waiting to order {it} once our account is ready.", "Waiting to order", {"follow_up": 0.6, "setup_request": 0.4}),
        ("Can you supply {q} {u} of {it} next week? Let me know if possible.", "Supply next week?", {"enquiry": 0.5, "purchase_order": 0.5}),
        ("Further to our call, please go ahead with {it}.", "Further to our call", {"purchase_order": 0.7, "follow_up": 0.3}),
        ("Please update our delivery address and send the next order of {it} there.", "Delivery address", {"setup_request": 0.6, "purchase_order": 0.4}),
    ]
    for _ in range(230):
        c = pick(real)
        tmpl, subj, dist = mixed[int(rng.integers(len(mixed)))]
        it = pick(all_items)
        body = f"{pick(GREET[c['country']])}, " + tmpl.format(q=int(rng.integers(5, 300)), u=it["uom"], it=it["description"])
        label = str(rng.choice(list(dist), p=list(dist.values())))
        add(stamp(random_day(pick(MONTHS))), c["country"], c["customer_id"], c["name"], subj, body, label)

    msgs.sort(key=lambda m: m["received_at"])
    for i, m in enumerate(msgs, start=1):
        m["msg_id"] = f"MSG-{i:05d}"
    return msgs


# ---------------------------------------------------------------------------
# 6. Assemble
# ---------------------------------------------------------------------------
def main():
    DATA.mkdir(exist_ok=True)
    customers, by_key = build_customers()

    # New customers: their setup goes through today's email process; first order follows completion.
    mdm_rows = []
    for c in customers:
        if c["new_setup"]:
            sub = datetime.strptime(c["new_setup"], "%Y-%m-%d").replace(hour=10)
            sim = simulate_email_request("Customer", sub)
            done = sim["completed"]
            first = (done + timedelta(days=int(rng.integers(3, 14)))).date()
            c["setup_submitted"] = sub.date()
            c["created"] = done.date()
            c["first_order_month"] = f"{first:%Y-%m}"
            c["first_order_date"] = first
            mdm_rows.append(dict(domain="Customer", entity=c["entity"], country=c["country"],
                                 subject=f"New customer: {c['name']}", submitted=sub, sim=sim,
                                 linked=c["name"], duplicate=False))

    customers = add_duplicates(customers, by_key)
    for d in customers:
        if d["is_duplicate"] and d["created"] >= date(2025, 10, 1):
            sub = datetime.combine(d["created"] - timedelta(days=int(rng.integers(14, 22))), datetime.min.time()).replace(hour=11)
            sim = simulate_email_request("Customer", sub)
            mdm_rows.append(dict(domain="Customer", entity=d["entity"], country=d["country"],
                                 subject=f"New customer: {d['name']}", submitted=sub, sim=sim,
                                 linked=d["name"], duplicate=True))

    # assign customer ids by creation date within each country
    seq = {k: 0 for k in COUNTRIES}
    for c in sorted(customers, key=lambda c: c["created"]):
        home = by_key[c["duplicate_of_key"]]["country"] if c["is_duplicate"] else c["country"]
        id_country = c["country"]  # the record carries the country it was created with
        seq[id_country] += 1
        c["customer_id"] = f"C-{id_country}-{seq[id_country]:04d}"
        c["home_country"] = home

    items = build_items()
    vendors = build_vendors()
    cost_centres = build_cost_centres()
    orders = build_orders(customers, items)

    prospects = []
    for i, (country, name, segment, size, city, entity, prods, submitted) in enumerate(PROSPECTS, start=1):
        sub = datetime.strptime(submitted, "%Y-%m-%d").date()
        prospects.append(dict(prospect_id=f"P-{country}-{i:03d}", country=country, name=name, segment=segment,
                              size=size, city=city, entity=entity, products=prods, setup_submitted=sub,
                              reg_no=make_reg_no(country, int(rng.integers(2015, 2025))),
                              address=make_address(country, city), phone=make_phone(country)))
    messages = build_messages(customers, orders, items, prospects)

    # Generic email-era MDM history (Oct 2025 - Sep 2026), ~30 requests a month
    gen_subjects = {
        "Customer": lambda: f"New customer: {pick(['ship-to for', 'one-off buyer', 'new clinic', 'new lab'])} {pick(list(COUNTRIES.values()))}",
        "Item": lambda: f"New item: {pick([d for line in ITEMS.values() for d, *_ in line])[:48]}",
        "Vendor": lambda: f"New vendor: {pick(['freight forwarder', 'calibration service', 'packaging supplier', 'principal', 'IT services'])}",
        "Cost centre": lambda: f"New cost centre: {pick(['SPD', 'QTS', 'QTG'])} {pick(['Sales', 'Marketing', 'Service', 'Warehouse'])}",
    }
    for ym in MONTHS:
        for _ in range(rng.poisson(28)):
            domain = str(rng.choice(["Customer", "Item", "Vendor", "Cost centre"], p=[0.28, 0.42, 0.15, 0.15]))
            d = random_day(ym)
            sub = datetime(d.year, d.month, d.day, int(rng.integers(8, 18)), int(rng.integers(0, 60)))
            mdm_rows.append(dict(domain=domain, entity=pick(list(ENTITIES)), country=pick(list(COUNTRIES)),
                                 subject=gen_subjects[domain](), submitted=sub, sim=simulate_email_request(domain, sub),
                                 linked="", duplicate=False))
    for p in prospects:  # still in flight on 30 Sep
        sub = datetime.combine(p["setup_submitted"], datetime.min.time()).replace(hour=10)
        mdm_rows.append(dict(domain="Customer", entity=p["entity"], country=p["country"], subject=f"New customer: {p['name']}",
                             submitted=sub, sim=simulate_email_request("Customer", sub), linked=p["name"], duplicate=False,
                             force_open=True))

    mdm_out = []
    for i, r in enumerate(sorted(mdm_rows, key=lambda r: r["submitted"]), start=1):
        sim = r["sim"]
        as_of_dt = datetime(2026, 9, 30, 18, 0)
        is_open = r.get("force_open") or sim["completed"] > as_of_dt
        steps = []
        for s in sim["steps"]:
            entry = {"step": s["step"], "done": s["done"].strftime("%Y-%m-%d %H:%M") if s["done"] <= as_of_dt else ""}
            if "sent" in s:
                entry["sent"] = s["sent"].strftime("%Y-%m-%d %H:%M") if s["sent"] <= as_of_dt else ""
            steps.append(entry)
        current = next((s["step"] for s in steps if not s["done"]), "") if is_open else ""
        if r.get("force_open") and not current:
            current = steps[-2]["step"]
            steps[-1]["done"] = ""
            steps[-2]["done"] = ""
        mdm_out.append(dict(
            request_id=f"MDM-{r['submitted']:%y%m}-{i:04d}", domain=r["domain"], entity=r["entity"], country=r["country"],
            subject=r["subject"], submitted_at=r["submitted"].strftime("%Y-%m-%d %H:%M"),
            completed_at="" if is_open else sim["completed"].strftime("%Y-%m-%d %H:%M"),
            status="Open" if is_open else "Completed", current_step=current,
            approvals=len(sim["approvers"]), approvers="; ".join(sim["approvers"]), bounce_backs=sim["bounces"],
            clarifications=sim["clarifications"],
            turnaround_days="" if is_open else round((sim["completed"] - r["submitted"]).total_seconds() / 86400, 1),
            duplicate_created=r["duplicate"], linked_record=r["linked"], steps=json.dumps(steps),
        ))

    # ---------------- write files ----------------
    cust_df = pd.DataFrame([{
        "customer_id": c["customer_id"], "name": c["name"], "entity": c["entity"], "country": c["country"],
        "city": c["city"], "segment": c["segment"], "size": c["size"], "reg_no": c["reg_no"], "address": c["address"],
        "phone": c["phone"], "email": c["email"], "payment_terms": c["payment_terms"], "credit_limit": c["credit_limit"],
        "created": date_str(c["created"]),
    } for c in sorted(customers, key=lambda c: c["customer_id"])])
    cust_df.to_csv(DATA / "customers.csv", index=False)

    pd.DataFrame([{k: (date_str(v) if isinstance(v, date) else v) for k, v in r.items() if k not in ("is_duplicate", "duplicate_of")}
                  for r in items]).to_csv(DATA / "items.csv", index=False)
    pd.DataFrame([{k: (date_str(v) if isinstance(v, date) else v) for k, v in r.items() if k not in ("is_duplicate", "duplicate_of")}
                  for r in vendors]).to_csv(DATA / "vendors.csv", index=False)
    pd.DataFrame(cost_centres).to_csv(DATA / "cost_centres.csv", index=False)
    po_df = pd.DataFrame(orders).drop(columns=["true_customer_id"]).sort_values(["po_date", "po_id"])
    po_df["po_date"] = po_df["po_date"].map(date_str)
    po_df.to_csv(DATA / "purchase_orders.csv", index=False)
    msg_df = pd.DataFrame(messages)[["msg_id", "received_at", "country", "customer_id", "sender_org", "subject", "body",
                                     "true_type", "linked_po", "linked_ref"]]
    msg_df["received_at"] = msg_df["received_at"].map(lambda d: d.strftime("%Y-%m-%d %H:%M"))
    msg_df.to_csv(DATA / "inbound_messages.csv", index=False)
    pd.DataFrame(mdm_out).to_csv(DATA / "mdm_requests.csv", index=False)
    pd.DataFrame([{k: (date_str(v) if isinstance(v, date) else v) for k, v in p.items()} for p in prospects]).to_csv(
        DATA / "prospects.csv", index=False)

    id_of = {c["key"]: c["customer_id"] for c in customers if c["key"]}
    truth = {
        "note": "Ground truth for patterns planted in the synthetic data. Used by tests and to check the analysis finds them.",
        "duplicate_customers": [
            dict(original_id=id_of[d["orig"]], duplicate_id=id_of[f"DUP_{d['orig']}"], original_name=by_key[d["orig"]]["name"],
                 duplicate_name=d["name"], products_booked_to_duplicate=d["products"], from_month=d["start"],
                 wrong_country=d.get("country"), story=d["story"])
            for d in DUPLICATES],
        "near_miss_pairs_not_duplicates": [
            [id_of["N_SAIGONEYE"], id_of["SAIGON"]], [id_of["N_HANOIHOSP"], id_of["HANOI"]],
            [id_of["N_BKKDENTAL"], id_of["BKKRIVER"]], [id_of["N_LIONDENTAL"], id_of["LIONCITY"]]],
        "duplicate_items": [dict(duplicate=next(i["item_code"] for i in items if i["description"] == dd),
                                 original=next(i["item_code"] for i in items if i["description"] == od))
                            for dd, od in ITEM_DUPLICATES.items()],
        "duplicate_vendors": [dict(duplicate=next(v["vendor_code"] for v in vendors if v["name"] == dn),
                                   original=next(v["vendor_code"] for v in vendors if v["name"] == on))
                              for dn, on in VENDOR_DUPLICATES],
        "real_churn": [dict(customer_id=c["customer_id"], name=c["name"], decline_from=c["churn"][0], last_month=c["churn"][1])
                       for c in customers if c.get("churn") and not c["is_duplicate"]],
        "new_customers": [dict(customer_id=c["customer_id"], name=c["name"], country=c["country"],
                               setup_submitted=date_str(c["setup_submitted"]), account_created=date_str(c["created"]),
                               first_order_month=c["first_order_month"])
                          for c in customers if c.get("setup_submitted") and not c["is_duplicate"]],
        "pending_setups": [dict(prospect_id=p["prospect_id"], name=p["name"], country=p["country"],
                                setup_submitted=date_str(p["setup_submitted"])) for p in prospects],
        "trends": TREND,
    }
    (DATA / "planted_patterns.json").write_text(json.dumps(truth, indent=2, default=str))

    # quick summary
    hist = pd.DataFrame(mdm_out)
    done = pd.to_numeric(hist.loc[hist.status == "Completed", "turnaround_days"])
    print(f"customers: {len(cust_df)} records ({sum(c['is_duplicate'] for c in customers)} planted duplicates)")
    print(f"items: {len(items)}, vendors: {len(vendors)}, cost centres: {len(cost_centres)}")
    print(f"purchase orders: {len(po_df)}  value SGD {po_df.value_sgd.sum():,.0f}")
    print(f"messages: {len(msg_df)}  by type: {msg_df.true_type.value_counts().to_dict()}")
    print(f"mdm requests: {len(hist)}  open: {(hist.status == 'Open').sum()}  turnaround mean {done.mean():.1f} "
          f"median {done.median():.1f} p90 {done.quantile(0.9):.1f}")


if __name__ == "__main__":
    main()
