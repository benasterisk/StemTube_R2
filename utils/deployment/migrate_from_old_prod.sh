#!/bin/bash

# ============================================================================
# SCRIPT DE MIGRATION: Ancienne Prod → Nouvelle Prod
# ============================================================================
# Ce script récupère la base de données et les fichiers audio
# depuis l'ancienne machine de production.
#
# PRÉREQUIS:
# - Accès SSH à l'ancienne machine de prod
# - Assez d'espace disque sur la nouvelle machine
# - Application arrêtée pendant la migration
#
# USAGE:
#   1. Éditer les variables ci-dessous (OLD_PROD_HOST, OLD_PROD_PATH)
#   2. Rendre le script exécutable: chmod +x migrate_from_old_prod.sh
#   3. Lancer: ./migrate_from_old_prod.sh
# ============================================================================

set -e  # Arrêt immédiat en cas d'erreur

# ============================================================================
# CONFIGURATION - À MODIFIER SELON VOTRE ENVIRONNEMENT
# ============================================================================

# Ancienne machine de production
OLD_PROD_HOST="user@192.168.1.59"  # Format: user@hostname ou user@ip (MODIFIER)
OLD_PROD_PATH="/opt/stemtube/StemTube-dev"  # Chemin sur l'ancienne machine

# Nouvelle machine (actuelle)
NEW_PROD_PATH="$(cd "$(dirname "$0")/../.." && pwd)"  # Auto-détecte le chemin du projet

# Répertoire de backup
BACKUP_DIR="${NEW_PROD_PATH}/migration_backup_$(date +%Y%m%d_%H%M%S)"

# ============================================================================
# COULEURS POUR L'AFFICHAGE
# ============================================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ============================================================================
# FONCTIONS UTILITAIRES
# ============================================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_ssh_connection() {
    log_info "Vérification de la connexion SSH vers $OLD_PROD_HOST..."
    if ssh -o ConnectTimeout=5 "$OLD_PROD_HOST" "echo 'SSH OK'" > /dev/null 2>&1; then
        log_success "Connexion SSH établie"
        return 0
    else
        log_error "Impossible de se connecter à $OLD_PROD_HOST"
        echo ""
        echo "Vérifiez:"
        echo "  1. Le hostname/IP est correct"
        echo "  2. Vous avez les clés SSH configurées"
        echo "  3. Le serveur est accessible"
        echo ""
        echo "Test manuel: ssh $OLD_PROD_HOST"
        return 1
    fi
}

check_disk_space() {
    log_info "Vérification de l'espace disque..."

    # Obtenir la taille des données sur l'ancienne machine
    OLD_SIZE=$(ssh "$OLD_PROD_HOST" "du -sb ${OLD_PROD_PATH}/core/downloads 2>/dev/null || echo 0" | cut -f1)
    OLD_SIZE_GB=$(echo "scale=2; $OLD_SIZE / 1024 / 1024 / 1024" | bc)

    # Obtenir l'espace libre sur la nouvelle machine
    FREE_SPACE=$(df "$NEW_PROD_PATH" | tail -1 | awk '{print $4}')
    FREE_SPACE_GB=$(echo "scale=2; $FREE_SPACE / 1024 / 1024" | bc)

    log_info "Taille des données à transférer: ${OLD_SIZE_GB} GB"
    log_info "Espace disque disponible: ${FREE_SPACE_GB} GB"

    if (( $(echo "$FREE_SPACE > $OLD_SIZE * 1.2" | bc -l) )); then
        log_success "Espace disque suffisant"
        return 0
    else
        log_warning "Espace disque peut-être insuffisant (marge de 20% recommandée)"
        read -p "Continuer quand même? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            return 1
        fi
    fi
}

stop_application() {
    log_info "Arrêt de l'application StemTube..."

    # Chercher les processus Python app.py
    PIDS=$(pgrep -f "python.*app.py" || true)

    if [ -z "$PIDS" ]; then
        log_info "Aucun processus app.py en cours d'exécution"
    else
        log_info "Processus trouvés: $PIDS"
        pkill -f "python.*app.py" || true
        sleep 2
        log_success "Application arrêtée"
    fi
}

# ============================================================================
# ÉTAPE 1: BACKUP DES DONNÉES ACTUELLES (DEV)
# ============================================================================

backup_current_data() {
    log_info "============================================================"
    log_info "ÉTAPE 1/4: Backup des données actuelles (DEV)"
    log_info "============================================================"

    mkdir -p "$BACKUP_DIR"
    log_info "Répertoire de backup: $BACKUP_DIR"

    # Backup de la base de données DEV
    if [ -f "${NEW_PROD_PATH}/stemtubes.db" ]; then
        log_info "Sauvegarde de stemtubes.db (DEV)..."
        cp "${NEW_PROD_PATH}/stemtubes.db" "${BACKUP_DIR}/stemtubes_dev.db"
        log_success "Base de données DEV sauvegardée"
    else
        log_warning "Aucune base stemtubes.db trouvée"
    fi

    # Backup des fichiers DEV (si présents)
    if [ -d "${NEW_PROD_PATH}/core/downloads" ]; then
        log_info "Sauvegarde des fichiers downloads (DEV)..."
        mkdir -p "${BACKUP_DIR}/downloads_dev"
        cp -r "${NEW_PROD_PATH}/core/downloads/"* "${BACKUP_DIR}/downloads_dev/" 2>/dev/null || log_info "Aucun fichier à sauvegarder"
        log_success "Fichiers DEV sauvegardés"
    fi

    log_success "Backup terminé: $BACKUP_DIR"
}

# ============================================================================
# ÉTAPE 2: RÉCUPÉRATION DE LA BASE DE DONNÉES PROD
# ============================================================================

retrieve_database() {
    log_info "============================================================"
    log_info "ÉTAPE 2/4: Récupération de la base de données PROD"
    log_info "============================================================"

    log_info "Téléchargement de stemtubes.db depuis $OLD_PROD_HOST..."

    # Vérifier que la base existe sur l'ancienne machine
    if ssh "$OLD_PROD_HOST" "[ -f ${OLD_PROD_PATH}/stemtubes.db ]"; then
        # Télécharger la base avec rsync (reprise possible)
        rsync -avzh --progress \
            "${OLD_PROD_HOST}:${OLD_PROD_PATH}/stemtubes.db" \
            "${NEW_PROD_PATH}/stemtubes.db"

        log_success "Base de données récupérée"

        # Afficher quelques stats
        log_info "Statistiques de la base:"
        sqlite3 "${NEW_PROD_PATH}/stemtubes.db" "SELECT COUNT(*) FROM users;" | xargs -I {} echo "  - Utilisateurs: {}"
        sqlite3 "${NEW_PROD_PATH}/stemtubes.db" "SELECT COUNT(*) FROM global_downloads;" | xargs -I {} echo "  - Downloads globaux: {}"
        sqlite3 "${NEW_PROD_PATH}/stemtubes.db" "SELECT COUNT(*) FROM global_downloads WHERE extracted=1;" | xargs -I {} echo "  - Extractions: {}"
    else
        log_error "Base de données introuvable sur ${OLD_PROD_HOST}:${OLD_PROD_PATH}/stemtubes.db"
        return 1
    fi
}

# ============================================================================
# ÉTAPE 3: RÉCUPÉRATION DES FICHIERS AUDIO
# ============================================================================

retrieve_audio_files() {
    log_info "============================================================"
    log_info "ÉTAPE 3/4: Récupération des fichiers audio PROD"
    log_info "============================================================"

    log_info "Téléchargement du répertoire downloads depuis $OLD_PROD_HOST..."
    log_warning "Cela peut prendre du temps selon la taille des données..."

    # Créer le répertoire si nécessaire
    mkdir -p "${NEW_PROD_PATH}/core/downloads"

    # Utiliser rsync pour le transfert (efficace, reprise possible)
    rsync -avzh --progress \
        --exclude '*.tmp' \
        --exclude '*.part' \
        "${OLD_PROD_HOST}:${OLD_PROD_PATH}/core/downloads/" \
        "${NEW_PROD_PATH}/core/downloads/"

    log_success "Fichiers audio récupérés"

    # Afficher des stats
    log_info "Statistiques des fichiers:"
    AUDIO_COUNT=$(find "${NEW_PROD_PATH}/core/downloads" -name "*.mp3" -type f | wc -l)
    TOTAL_SIZE=$(du -sh "${NEW_PROD_PATH}/core/downloads" | cut -f1)
    echo "  - Fichiers MP3: $AUDIO_COUNT"
    echo "  - Taille totale: $TOTAL_SIZE"
}

# ============================================================================
# ÉTAPE 4: VÉRIFICATION DE L'INTÉGRITÉ
# ============================================================================

verify_integrity() {
    log_info "============================================================"
    log_info "ÉTAPE 4/4: Vérification de l'intégrité"
    log_info "============================================================"

    # Vérifier la base de données
    log_info "Vérification de l'intégrité de la base de données..."
    if sqlite3 "${NEW_PROD_PATH}/stemtubes.db" "PRAGMA integrity_check;" | grep -q "ok"; then
        log_success "Base de données intègre"
    else
        log_error "Problème d'intégrité de la base de données!"
        return 1
    fi

    # Vérifier la cohérence fichiers <-> base
    log_info "Vérification de la cohérence fichiers/base de données..."

    # Compter les downloads dans la base
    DB_DOWNLOADS=$(sqlite3 "${NEW_PROD_PATH}/stemtubes.db" "SELECT COUNT(*) FROM global_downloads;")

    # Compter les dossiers de downloads
    FOLDER_COUNT=$(find "${NEW_PROD_PATH}/core/downloads" -mindepth 1 -maxdepth 1 -type d | wc -l)

    log_info "Downloads en base: $DB_DOWNLOADS"
    log_info "Dossiers présents: $FOLDER_COUNT"

    if [ "$FOLDER_COUNT" -ge "$DB_DOWNLOADS" ]; then
        log_success "Cohérence OK (au moins autant de dossiers que d'entrées en base)"
    else
        log_warning "Il y a plus d'entrées en base que de dossiers de fichiers"
        log_warning "Certains fichiers peuvent être manquants"
    fi

    # Vérifier les permissions
    log_info "Ajustement des permissions..."
    chmod -R u+rw "${NEW_PROD_PATH}/core/downloads"
    log_success "Permissions ajustées"
}

# ============================================================================
# FONCTION PRINCIPALE
# ============================================================================

main() {
    echo ""
    log_info "╔════════════════════════════════════════════════════════════╗"
    log_info "║   MIGRATION STEMTUBE: Ancienne Prod → Nouvelle Prod       ║"
    log_info "╚════════════════════════════════════════════════════════════╝"
    echo ""

    # Afficher la configuration
    echo "Configuration:"
    echo "  • Ancienne PROD: ${OLD_PROD_HOST}:${OLD_PROD_PATH}"
    echo "  • Nouvelle PROD: ${NEW_PROD_PATH}"
    echo "  • Backup: ${BACKUP_DIR}"
    echo ""

    # Confirmation
    log_warning "⚠️  ATTENTION: Cette opération va:"
    echo "  1. Arrêter l'application StemTube"
    echo "  2. Sauvegarder les données actuelles (DEV)"
    echo "  3. Remplacer la base et les fichiers par ceux de l'ancienne PROD"
    echo ""
    read -p "Voulez-vous continuer? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Migration annulée"
        exit 0
    fi

    # Vérifications préliminaires
    if ! check_ssh_connection; then
        exit 1
    fi

    if ! check_disk_space; then
        exit 1
    fi

    # Arrêter l'application
    stop_application

    # Exécuter les étapes
    backup_current_data
    retrieve_database
    retrieve_audio_files
    verify_integrity

    # Résumé final
    echo ""
    log_success "╔════════════════════════════════════════════════════════════╗"
    log_success "║           MIGRATION TERMINÉE AVEC SUCCÈS!                  ║"
    log_success "╚════════════════════════════════════════════════════════════╝"
    echo ""
    log_info "Prochaines étapes:"
    echo "  1. Démarrer l'application: python app.py"
    echo "  2. Tester la connexion avec les comptes PROD"
    echo "  3. Vérifier que les downloads/extractions sont présents"
    echo ""
    log_info "En cas de problème, les données DEV sont sauvegardées ici:"
    echo "  → $BACKUP_DIR"
    echo ""
}

# ============================================================================
# LANCEMENT DU SCRIPT
# ============================================================================

main "$@"
