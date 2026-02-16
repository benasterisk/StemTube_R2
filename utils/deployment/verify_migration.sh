#!/bin/bash

# ============================================================================
# SCRIPT DE VÉRIFICATION POST-MIGRATION
# ============================================================================
# Ce script vérifie que la migration s'est bien déroulée
# en comparant les données de la nouvelle machine avec l'ancienne
#
# USAGE: ./verify_migration.sh
# ============================================================================

set -e

# Configuration
DB_PATH="stemtubes.db"
DOWNLOADS_PATH="core/downloads"

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

log_error() {
    echo -e "${RED}[✗]${NC} $1"
}

echo ""
log_info "╔════════════════════════════════════════════════════════════╗"
log_info "║        VÉRIFICATION POST-MIGRATION STEMTUBE                ║"
log_info "╚════════════════════════════════════════════════════════════╝"
echo ""

# ============================================================================
# 1. VÉRIFICATION BASE DE DONNÉES
# ============================================================================

log_info "1. Vérification de la base de données"
echo "   ────────────────────────────────────"

if [ ! -f "$DB_PATH" ]; then
    log_error "Base de données introuvable: $DB_PATH"
    exit 1
fi

log_success "Base de données trouvée"

# Intégrité
INTEGRITY=$(sqlite3 "$DB_PATH" "PRAGMA integrity_check;" 2>&1)
if [ "$INTEGRITY" = "ok" ]; then
    log_success "Intégrité de la base: OK"
else
    log_error "Intégrité de la base: ERREUR"
    echo "$INTEGRITY"
    exit 1
fi

# Statistiques
echo ""
log_info "   Statistiques de la base:"

USERS=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM users;")
ADMINS=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM users WHERE is_admin=1;")
DOWNLOADS=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM global_downloads;")
EXTRACTIONS=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM global_downloads WHERE extracted=1;")
USER_DOWNLOADS=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM user_downloads;")

echo "   • Utilisateurs: $USERS (dont $ADMINS admin)"
echo "   • Downloads globaux: $DOWNLOADS"
echo "   • Extractions: $EXTRACTIONS"
echo "   • Accès utilisateur aux downloads: $USER_DOWNLOADS"

# Vérifier qu'il y a au moins un admin
if [ "$ADMINS" -eq 0 ]; then
    log_warning "ATTENTION: Aucun administrateur dans la base!"
    echo "   Vous devrez créer un admin avec: python reset_admin_password.py"
fi

# ============================================================================
# 2. VÉRIFICATION FICHIERS
# ============================================================================

echo ""
log_info "2. Vérification des fichiers"
echo "   ────────────────────────────────────"

if [ ! -d "$DOWNLOADS_PATH" ]; then
    log_error "Répertoire downloads introuvable: $DOWNLOADS_PATH"
    exit 1
fi

log_success "Répertoire downloads trouvé"

# Compter les fichiers
AUDIO_FILES=$(find "$DOWNLOADS_PATH" -name "*.mp3" -type f | wc -l)
STEM_DIRS=$(find "$DOWNLOADS_PATH" -name "stems" -type d | wc -l)
TOTAL_SIZE=$(du -sh "$DOWNLOADS_PATH" 2>/dev/null | cut -f1)

echo ""
log_info "   Statistiques des fichiers:"
echo "   • Fichiers MP3: $AUDIO_FILES"
echo "   • Dossiers stems: $STEM_DIRS"
echo "   • Taille totale: $TOTAL_SIZE"

# ============================================================================
# 3. COHÉRENCE BASE <-> FICHIERS
# ============================================================================

echo ""
log_info "3. Cohérence base de données ↔ fichiers"
echo "   ────────────────────────────────────"

# Compter les dossiers de downloads
FOLDER_COUNT=$(find "$DOWNLOADS_PATH" -mindepth 1 -maxdepth 1 -type d | wc -l)

echo "   • Downloads en base: $DOWNLOADS"
echo "   • Dossiers présents: $FOLDER_COUNT"

if [ "$FOLDER_COUNT" -ge "$DOWNLOADS" ]; then
    log_success "Cohérence OK (au moins autant de dossiers que d'entrées)"
else
    log_warning "Il y a plus d'entrées en base ($DOWNLOADS) que de dossiers ($FOLDER_COUNT)"
    log_warning "Certains fichiers peuvent être manquants"
fi

# Vérifier quelques chemins aléatoires
log_info "   Vérification de chemins aléatoires..."

SAMPLE_PATHS=$(sqlite3 "$DB_PATH" "SELECT file_path FROM global_downloads WHERE file_path IS NOT NULL LIMIT 5;")
MISSING_COUNT=0
CHECKED_COUNT=0

while IFS= read -r path; do
    if [ -n "$path" ]; then
        CHECKED_COUNT=$((CHECKED_COUNT + 1))
        if [ ! -f "$path" ]; then
            MISSING_COUNT=$((MISSING_COUNT + 1))
            log_warning "   Fichier manquant: $path"
        fi
    fi
done <<< "$SAMPLE_PATHS"

if [ "$MISSING_COUNT" -eq 0 ] && [ "$CHECKED_COUNT" -gt 0 ]; then
    log_success "Échantillon de $CHECKED_COUNT fichiers: tous présents"
elif [ "$CHECKED_COUNT" -eq 0 ]; then
    log_warning "Aucun chemin de fichier trouvé en base pour vérification"
else
    log_warning "$MISSING_COUNT/$CHECKED_COUNT fichiers manquants dans l'échantillon"
fi

# ============================================================================
# 4. PERMISSIONS
# ============================================================================

echo ""
log_info "4. Vérification des permissions"
echo "   ────────────────────────────────────"

if [ -r "$DB_PATH" ] && [ -w "$DB_PATH" ]; then
    log_success "Base de données: lecture/écriture OK"
else
    log_error "Base de données: problème de permissions"
fi

if [ -r "$DOWNLOADS_PATH" ] && [ -w "$DOWNLOADS_PATH" ] && [ -x "$DOWNLOADS_PATH" ]; then
    log_success "Répertoire downloads: lecture/écriture/exécution OK"
else
    log_error "Répertoire downloads: problème de permissions"
    echo "   Correction: chmod -R u+rwx $DOWNLOADS_PATH"
fi

# ============================================================================
# 5. CONFIGURATION
# ============================================================================

echo ""
log_info "5. Vérification de la configuration"
echo "   ────────────────────────────────────"

if [ -f "core/config.json" ]; then
    log_success "Fichier config.json trouvé"

    # Vérifier la configuration GPU
    GPU_ENABLED=$(python3 -c "import json; print(json.load(open('core/config.json')).get('use_gpu_for_extraction', False))" 2>/dev/null)
    if [ "$GPU_ENABLED" = "True" ]; then
        echo "   • GPU activé pour les extractions"

        # Vérifier CUDA
        if python3 -c "import torch; print(torch.cuda.is_available())" 2>/dev/null | grep -q "True"; then
            log_success "CUDA disponible"
        else
            log_warning "CUDA non disponible (extraction CPU uniquement)"
        fi
    else
        echo "   • GPU désactivé (extraction CPU)"
    fi
else
    log_warning "Fichier config.json introuvable (valeurs par défaut utilisées)"
fi

# ============================================================================
# 6. DÉPENDANCES
# ============================================================================

echo ""
log_info "6. Vérification des dépendances Python"
echo "   ────────────────────────────────────"

# Vérifier les packages critiques
CRITICAL_PACKAGES=("flask" "torch" "demucs" "yt_dlp" "soundfile")
MISSING_PACKAGES=()

for pkg in "${CRITICAL_PACKAGES[@]}"; do
    if python3 -c "import $pkg" 2>/dev/null; then
        log_success "$pkg installé"
    else
        log_error "$pkg MANQUANT"
        MISSING_PACKAGES+=("$pkg")
    fi
done

if [ ${#MISSING_PACKAGES[@]} -gt 0 ]; then
    log_warning "Packages manquants: ${MISSING_PACKAGES[*]}"
    echo "   Réinstaller avec: ./venv/bin/pip install -r requirements.txt"
fi

# ============================================================================
# 7. PROCESSUS EN COURS
# ============================================================================

echo ""
log_info "7. Vérification des processus"
echo "   ────────────────────────────────────"

APP_RUNNING=$(pgrep -f "python.*app.py" || echo "")
if [ -n "$APP_RUNNING" ]; then
    log_success "Application en cours d'exécution (PID: $APP_RUNNING)"
echo "   • URL: http://localhost:5012"
else
    log_info "Application arrêtée"
    echo "   • Démarrer avec: python app.py"
fi

# ============================================================================
# RÉSUMÉ
# ============================================================================

echo ""
log_info "╔════════════════════════════════════════════════════════════╗"
log_info "║                      RÉSUMÉ                                ║"
log_info "╚════════════════════════════════════════════════════════════╝"
echo ""

# Calculer un score
ISSUES=0

if [ "$ADMINS" -eq 0 ]; then ISSUES=$((ISSUES + 1)); fi
if [ "$FOLDER_COUNT" -lt "$DOWNLOADS" ]; then ISSUES=$((ISSUES + 1)); fi
if [ "$MISSING_COUNT" -gt 0 ]; then ISSUES=$((ISSUES + 1)); fi
if [ ${#MISSING_PACKAGES[@]} -gt 0 ]; then ISSUES=$((ISSUES + 1)); fi

if [ $ISSUES -eq 0 ]; then
    log_success "✅ Migration réussie! Aucun problème détecté."
    echo ""
    echo "Vous pouvez maintenant:"
    echo "  1. Démarrer l'application: python app.py"
    echo "  2. Vous connecter avec vos comptes PROD"
    echo "  3. Vérifier que tout fonctionne normalement"
else
    log_warning "⚠️  $ISSUES problème(s) détecté(s)"
    echo ""
    echo "Consultez les warnings ci-dessus et corrigez avant de démarrer."
fi

echo ""
log_info "Pour plus de détails, consultez: MIGRATION_GUIDE.md"
echo ""
