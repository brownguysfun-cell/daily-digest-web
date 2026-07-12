#!/usr/bin/env python3
import os
import sys
import json
import time
import calendar
from datetime import datetime, timedelta, timezone
import feedparser
import requests
import google.generativeai as genai

# Configuration des flux RSS
FEEDS = {
    "Le Monde": "https://www.lemonde.fr/rss/une.xml",
    "The Guardian": "https://www.theguardian.com/world/rss",
    "BFM TV": "https://news.google.com/rss/search?q=site:bfmtv.com&hl=fr&gl=FR&ceid=FR:fr",
    "Reuters": "https://news.google.com/rss/search?q=site:reuters.com&hl=en&gl=US&ceid=US:en",
    "Bloomberg": "https://news.google.com/rss/search?q=site:bloomberg.com&hl=en&gl=US&ceid=US:en"
}

DATA_FILE = "data.json"

import re

def clean_html_and_truncate(text, max_len=200):
    if not text:
        return ""
    # Nettoyage des balises HTML
    clean = re.sub(r'<[^>]*>', '', text)
    clean = re.sub(r'\s+', ' ', clean)
    return clean.strip()[:max_len]

def fetch_articles():
    print("Début de la récupération des articles...")
    articles = []
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=30)  # Récupère les articles des dernières 30 heures

    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }

    for source_name, feed_url in FEEDS.items():
        print(f"Récupération de la source : {source_name}...")
        try:
            response = requests.get(feed_url, headers=headers, timeout=15)
            feed = feedparser.parse(response.text)
            count = 0
            for entry in feed.entries:
                # Récupération de la date de publication
                pub_date = None
                if hasattr(entry, 'published_parsed') and entry.published_parsed:
                    pub_date = datetime.fromtimestamp(calendar.timegm(entry.published_parsed), tz=timezone.utc)
                elif hasattr(entry, 'updated_parsed') and entry.updated_parsed:
                    pub_date = datetime.fromtimestamp(calendar.timegm(entry.updated_parsed), tz=timezone.utc)
                
                # Filtrage temporel et limitation à 5 articles par source
                if pub_date and pub_date >= cutoff:
                    articles.append({
                        "source": source_name,
                        "title": clean_html_and_truncate(entry.title, 120),
                        "description": clean_html_and_truncate(getattr(entry, "summary", ""), 200),
                        "link": entry.link,
                        "pub_date": pub_date.isoformat()
                    })
                    count += 1
                    if count >= 5:
                        break
            print(f"-> {count} articles récupérés de {source_name}")
        except Exception as e:
            print(f"Erreur lors de la lecture du flux {source_name}: {e}", file=sys.stderr)
            
    print(f"Total articles récupérés : {len(articles)}")
    return articles

def generate_digest(articles):
    if not articles:
        print("Aucun article récent à traiter.")
        return []

    # Préparation du contenu textuel des articles
    articles_formatted = []
    for idx, art in enumerate(articles):
        articles_formatted.append(
            f"[{idx}] Source: {art['source']}\n"
            f"Titre: {art['title']}\n"
            f"Description: {art['description']}\n"
            f"Lien: {art['link']}\n"
            f"---"
        )
    articles_text = "\n".join(articles_formatted)

    prompt = f"""
Tu es un analyste de veille stratégique et un rédacteur en chef d'un grand média.
Voici une liste d'articles d'actualité récoltés ces dernières 24 heures depuis diverses sources (Le Monde, BFM TV, Reuters, Bloomberg, The Guardian).

Tâche :
1. Analyse et regroupe les articles qui parlent du même sujet ou événement pour éviter les doublons.
2. Pour chaque sujet important, rédige une synthèse claire sous forme d'un digest d'information.
3. Chaque résumé doit faire 2 à 3 phrases claires, fluides, professionnelles et rédigées en français.
4. Assigne chaque sujet à l'une des catégories suivantes :
   - "Cybersécurité & IA"
   - "Intelligence Artificielle" (pour l'IA générale, hors cybersécurité)
   - "Finance & Marchés"
   - "Géopolitique"
   - "Médecine & Santé"
   - "Sciences & Technologies"
   - "Général"
5. Associe au sujet toutes les sources d'origine correspondantes (nom de la source et URL exacte de l'article). S'il y a plusieurs sources pour un même sujet, liste-les toutes dans le tableau "sources".
6. Estime le temps de lecture du résumé en minutes (un entier, typiquement 1 ou 2).
7. Évalue l'importance du sujet sur une échelle de 1 à 5 (5 étant une actualité mondiale majeure ou critique).

Renvoie le résultat STRICTEMENT sous la forme d'un tableau JSON d'objets (pas de texte avant ou après le JSON), respectant le format suivant :
[
  {{
    "title": "Titre accrocheur et court en français",
    "summary": "Résumé concis en français...",
    "category": "Catégorie parmi la liste imposée",
    "sources": [
      {{"name": "Nom de la source", "url": "URL d'origine"}}
    ],
    "reading_time": 2,
    "importance": 4
  }}
]

Articles collectés :
{articles_text}
"""

    # Détection des clés d'API disponibles
    groq_key = os.environ.get("GROQ_API_KEY")
    mistral_key = os.environ.get("MISTRAL_API_KEY")
    gemini_key = os.environ.get("GEMINI_API_KEY")

    if groq_key:
        print("Utilisation de l'API Groq (Llama-3.3)...")
        headers = {
            "Authorization": f"Bearer {groq_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": "llama-3.3-70b-versatile",
            "messages": [
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.3,
            "response_format": {"type": "json_object"}
        }
        try:
            r = requests.post("https://api.groq.com/openai/v1/chat/completions", headers=headers, json=payload, timeout=45)
            r.raise_for_status()
            res_json = r.json()
            raw_content = res_json["choices"][0]["message"]["content"]
            data = json.loads(raw_content)
            if isinstance(data, dict):
                # Llama peut parfois enrober le tableau dans un objet
                for v in data.values():
                    if isinstance(v, list):
                        data = v
                        break
            if isinstance(data, list):
                print(f"Digest généré avec Groq ! {len(data)} sujets identifiés.")
                return data
            else:
                print("Erreur: Le format retourné par Groq n'est pas un tableau.", file=sys.stderr)
        except Exception as e:
            print(f"Erreur lors de l'appel à l'API Groq : {e}", file=sys.stderr)

    if mistral_key:
        print("Utilisation de l'API Mistral (Mistral Large)...")
        headers = {
            "Authorization": f"Bearer {mistral_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": "mistral-large-latest",
            "messages": [
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.3,
            "response_format": {"type": "json_object"}
        }
        try:
            r = requests.post("https://api.mistral.ai/v1/chat/completions", headers=headers, json=payload, timeout=45)
            r.raise_for_status()
            res_json = r.json()
            raw_content = res_json["choices"][0]["message"]["content"]
            data = json.loads(raw_content)
            if isinstance(data, dict):
                for v in data.values():
                    if isinstance(v, list):
                        data = v
                        break
            if isinstance(data, list):
                print(f"Digest généré avec Mistral ! {len(data)} sujets identifiés.")
                return data
            else:
                print("Erreur: Le format retourné par Mistral n'est pas un tableau.", file=sys.stderr)
        except Exception as e:
            print(f"Erreur lors de l'appel à l'API Mistral : {e}", file=sys.stderr)

    if gemini_key:
        print("Utilisation de l'API Gemini...")
        try:
            genai.configure(api_key=gemini_key)
            model = genai.GenerativeModel("gemini-2.0-flash")
            response = model.generate_content(
                prompt,
                generation_config={"response_mime_type": "application/json"}
            )
            data = json.loads(response.text)
            print(f"Digest généré avec Gemini ! {len(data)} sujets identifiés.")
            return data
        except Exception as e:
            print(f"Erreur lors de l'appel à l'API Gemini : {e}", file=sys.stderr)

    print("Erreur : Aucune clé d'API valide ou fonctionnelle trouvée dans l'environnement.", file=sys.stderr)
    return []

def update_data_store(new_digest):
    today_str = datetime.now().strftime("%Y-%m-%d")
    
    # Chargement de l'ancien magasin de données s'il existe
    data_store = {
        "last_updated": "",
        "digests": {}
    }
    
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                data_store = json.load(f)
        except Exception as e:
            print(f"Avertissement : Impossible de charger {DATA_FILE}, création d'un nouveau fichier. ({e})")
            
    # Mise à jour des données
    data_store["last_updated"] = datetime.now(timezone.utc).isoformat()
    data_store["digests"][today_str] = new_digest
    
    # Limitation de l'historique aux 30 derniers jours
    sorted_dates = sorted(list(data_store["digests"].keys()), reverse=True)
    if len(sorted_dates) > 30:
        for date_to_remove in sorted_dates[30:]:
            del data_store["digests"][date_to_remove]
            print(f"Suppression du digest obsolète du : {date_to_remove}")

    # Enregistrement
    try:
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(data_store, f, ensure_ascii=False, indent=2)
        print(f"Base de données {DATA_FILE} mise à jour avec succès pour le {today_str}.")
    except Exception as e:
        print(f"Erreur lors de l'écriture dans {DATA_FILE}: {e}", file=sys.stderr)

def load_env():
    # Charge les variables d'environnement depuis un fichier .env s'il existe
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, val = line.split("=", 1)
                    os.environ[key.strip()] = val.strip().strip('"').strip("'")

def main():
    load_env()
    articles = fetch_articles()
    if articles:
        new_digest = generate_digest(articles)
        if new_digest:
            update_data_store(new_digest)
        else:
            print("Le digest généré est vide, aucune mise à jour effectuée.")
    else:
        print("Aucun article récupéré, fin du script.")

if __name__ == "__main__":
    main()
