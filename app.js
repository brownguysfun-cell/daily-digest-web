// ==========================================================================
// DAILY NEWS DIGEST - CORE APPLICATION LOGIC
// ==========================================================================

document.addEventListener("DOMContentLoaded", () => {
  // Application State
  let appData = null;
  let selectedDate = null;
  let activeCategory = "all";
  let searchQuery = "";
  let sortBy = "importance"; // 'importance' or 'reading_time'
  
  // TTS State
  let currentUtterance = null;
  let activeAudioBtn = null;

  // DOM Elements
  const dateSelect = document.getElementById("date-select");
  const lastUpdatedTime = document.getElementById("last-updated-time");
  const statTotalNews = document.getElementById("stat-total-news");
  const statTotalSources = document.getElementById("stat-total-sources");
  
  const searchInput = document.getElementById("search-input");
  const clearSearchBtn = document.getElementById("clear-search");
  
  const categoriesTrack = document.getElementById("categories-track");
  const categoryPills = document.querySelectorAll(".category-pill");
  
  const sortImportanceBtn = document.getElementById("sort-importance");
  const sortTimeBtn = document.getElementById("sort-time");
  const currentDateTitle = document.getElementById("current-date-title");
  
  const newsGrid = document.getElementById("news-grid");
  const emptyState = document.getElementById("empty-state");
  
  const audioToast = document.getElementById("audio-player-toast");
  const stopAudioBtn = document.getElementById("stop-audio-btn");

  // Category Color Map (matches CSS variables)
  const categoryColors = {
    "Cybersécurité & IA": "var(--color-cyber)",
    "Intelligence Artificielle": "var(--color-ia)",
    "Finance & Marchés": "var(--color-finance)",
    "Géopolitique": "var(--color-geopolitics)",
    "Médecine & Santé": "var(--color-health)",
    "Sciences & Technologies": "var(--color-tech)",
    "Général": "var(--color-general)"
  };

  // Category Translation / Matching for Pills
  const categorySelectors = {
    "Cybersécurité & IA": "count-cyber",
    "Intelligence Artificielle": "count-ia",
    "Finance & Marchés": "count-finance",
    "Géopolitique": "count-geopolitics",
    "Médecine & Santé": "count-health",
    "Sciences & Technologies": "count-tech",
    "Général": "count-general"
  };

  // ==========================================================================
  // DATA LOADING & INITIALIZATION
  // ==========================================================================
  async function init() {
    try {
      const response = await fetch("data.json");
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      appData = await response.json();
      
      // Mettre à jour l'heure de dernière mise à jour
      if (appData.last_updated) {
        const updateDate = new Date(appData.last_updated);
        lastUpdatedTime.textContent = updateDate.toLocaleTimeString("fr-FR", {
          hour: "2-digit",
          minute: "2-digit"
        }) + " (" + updateDate.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) + ")";
      }

      // Remplir le sélecteur de dates
      const dates = Object.keys(appData.digests).sort((a, b) => new Date(b) - new Date(a));
      if (dates.length === 0) {
        renderEmptyState("Aucun digest disponible pour le moment.");
        return;
      }

      dateSelect.innerHTML = "";
      dates.forEach((dateStr, idx) => {
        const option = document.createElement("option");
        option.value = dateStr;
        
        // Formatage lisible de la date
        const formattedDate = new Date(dateStr).toLocaleDateString("fr-FR", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric"
        });
        
        // Majuscule sur le jour
        option.textContent = formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1);
        dateSelect.appendChild(option);
      });

      // Sélectionner la date la plus récente par défaut
      selectedDate = dates[0];
      
      // Mettre à jour les compteurs globaux de catégories pour cette date
      updateCategoryCounts();
      
      // Afficher les données
      render();
      
    } catch (error) {
      console.error("Erreur lors de l'initialisation de l'application:", error);
      renderErrorState("Impossible de charger les données du digest. Veuillez vérifier que le fichier data.json existe et est valide.");
    }
  }

  // ==========================================================================
  // STATS & COUNT COMPUTATION
  // ==========================================================================
  function updateCategoryCounts() {
    if (!appData || !selectedDate) return;
    const items = appData.digests[selectedDate] || [];
    
    // Reset all counts
    document.getElementById("count-all").textContent = items.length;
    for (const key in categorySelectors) {
      const el = document.getElementById(categorySelectors[key]);
      if (el) el.textContent = 0;
    }
    
    // Count per category
    let sourceSet = new Set();
    items.forEach(item => {
      // Category count
      const selectorId = categorySelectors[item.category];
      if (selectorId) {
        const el = document.getElementById(selectorId);
        if (el) {
          el.textContent = parseInt(el.textContent) + 1;
        }
      }
      // Source count
      if (item.sources) {
        item.sources.forEach(src => sourceSet.add(src.name));
      }
    });

    // Update Sidebar stats
    statTotalNews.textContent = items.length;
    statTotalSources.textContent = sourceSet.size;
  }

  // ==========================================================================
  // RENDER FUNCTION (FILTERS, SORTS & CARD CREATION)
  // ==========================================================================
  function render() {
    if (!appData || !selectedDate) return;
    
    // Récupérer les articles du jour
    let items = [...(appData.digests[selectedDate] || [])];
    
    // Mettre à jour le titre du digest courant
    const d = new Date(selectedDate);
    const dateFormatted = d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
    currentDateTitle.textContent = `Digest du ${dateFormatted}`;

    // 1. Filtrer par catégorie
    if (activeCategory !== "all") {
      items = items.filter(item => item.category === activeCategory);
    }

    // 2. Filtrer par recherche textuelle
    if (searchQuery.trim() !== "") {
      const q = searchQuery.toLowerCase().trim();
      items = items.filter(item => 
        item.title.toLowerCase().includes(q) || 
        item.summary.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.sources.some(src => src.name.toLowerCase().includes(q))
      );
    }

    // 3. Trier les éléments
    if (sortBy === "importance") {
      items.sort((a, b) => b.importance - a.importance);
    } else if (sortBy === "reading_time") {
      items.sort((a, b) => a.reading_time - b.reading_time);
    }

    // 4. Afficher
    newsGrid.innerHTML = "";
    
    if (items.length === 0) {
      newsGrid.style.display = "none";
      emptyState.style.display = "block";
      return;
    }

    newsGrid.style.display = "grid";
    emptyState.style.display = "none";

    items.forEach((item, index) => {
      const card = createNewsCard(item, index);
      newsGrid.appendChild(card);
    });
  }

  // Helper template for card
  function createNewsCard(item, index) {
    const card = document.createElement("article");
    card.className = "news-card";
    
    const catColor = categoryColors[item.category] || "var(--color-general)";
    card.style.setProperty("--color-category", catColor);

    // Generation of Importance Dots
    let dotsHtml = "";
    for (let i = 1; i <= 5; i++) {
      dotsHtml += `<span class="dot ${i <= item.importance ? 'active' : ''}"></span>`;
    }

    // Generation of Sources badges
    let sourcesHtml = "";
    if (item.sources && item.sources.length > 0) {
      item.sources.forEach(src => {
        sourcesHtml += `
          <a href="${src.url}" target="_blank" rel="noopener noreferrer" class="source-badge">
            <span>${src.name}</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </a>
        `;
      });
    }

    card.innerHTML = `
      <div class="card-header">
        <div class="card-category-wrapper">
          <span class="category-tag">${item.category}</span>
          <div class="importance-dots" title="Niveau d'importance: ${item.importance}/5">
            ${dotsHtml}
          </div>
        </div>
        <div class="card-meta">
          <span class="reading-time">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            ${item.reading_time} min
          </span>
        </div>
      </div>
      <div class="card-body">
        <h3>${item.title}</h3>
        <p>${item.summary}</p>
      </div>
      <div class="card-footer">
        <div class="sources-list">
          ${sourcesHtml}
        </div>
        <button class="audio-btn" title="Écouter la synthèse vocale" aria-label="Écouter le résumé">
          <svg class="audio-play-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
        </button>
      </div>
    `;

    // Hook listeners
    const audioBtn = card.querySelector(".audio-btn");
    audioBtn.addEventListener("click", () => handleTextToSpeech(item, audioBtn));
    
    // Cliquer sur le titre permet aussi d'écouter
    const title = card.querySelector("h3");
    title.addEventListener("click", () => handleTextToSpeech(item, audioBtn));

    return card;
  }

  // Empty state screen
  function renderEmptyState(message) {
    newsGrid.style.display = "none";
    emptyState.style.display = "block";
    emptyState.querySelector("p").textContent = message;
  }

  function renderErrorState(message) {
    renderEmptyState(message);
    emptyState.querySelector(".empty-icon").textContent = "⚠️";
    emptyState.querySelector("h3").textContent = "Une erreur est survenue";
  }

  // ==========================================================================
  // TEXT TO SPEECH (SYNTHÈSE VOCALE)
  // ==========================================================================
  function handleTextToSpeech(item, button) {
    // Si la synthèse vocale est en cours d'exécution sur ce bouton, on l'arrête
    if (window.speechSynthesis.speaking && activeAudioBtn === button) {
      stopAudio();
      return;
    }

    // Sinon, on arrête tout flux en cours d'abord
    stopAudio();

    // Début de la lecture
    activeAudioBtn = button;
    activeAudioBtn.classList.add("playing");
    
    // Toast visible
    audioToast.querySelector(".audio-title").textContent = item.title;
    audioToast.classList.add("visible");

    const textToSpeak = `${item.title}. Catégorie : ${item.category}. ${item.summary}`;
    currentUtterance = new SpeechSynthesisUtterance(textToSpeak);
    currentUtterance.lang = "fr-FR";
    currentUtterance.rate = 1.05; // Vitesse légèrement supérieure pour fluidité

    // Fin naturelle
    currentUtterance.onend = () => {
      stopAudio();
    };

    currentUtterance.onerror = () => {
      stopAudio();
    };

    window.speechSynthesis.speak(currentUtterance);
  }

  function stopAudio() {
    window.speechSynthesis.cancel();
    
    if (activeAudioBtn) {
      activeAudioBtn.classList.remove("playing");
      activeAudioBtn = null;
    }
    
    audioToast.classList.remove("visible");
    currentUtterance = null;
  }

  stopAudioBtn.addEventListener("click", stopAudio);

  // Arrêter l'audio si l'utilisateur quitte l'onglet ou ferme le site
  window.addEventListener("beforeunload", () => {
    window.speechSynthesis.cancel();
  });

  // ==========================================================================
  // EVENTS & INTERACTION HANDLERS
  // ==========================================================================
  
  // Changement de date
  dateSelect.addEventListener("change", (e) => {
    selectedDate = e.target.value;
    stopAudio();
    updateCategoryCounts();
    render();
  });

  // Recherche textuelle
  searchInput.addEventListener("input", (e) => {
    searchQuery = e.target.value;
    if (searchQuery.trim() !== "") {
      clearSearchBtn.style.display = "flex";
    } else {
      clearSearchBtn.style.display = "none";
    }
    render();
  });

  // Effacer la recherche
  clearSearchBtn.addEventListener("click", () => {
    searchInput.value = "";
    searchQuery = "";
    clearSearchBtn.style.display = "none";
    searchInput.focus();
    render();
  });

  // Sélection des catégories
  categoriesTrack.addEventListener("click", (e) => {
    const pill = e.target.closest(".category-pill");
    if (!pill) return;

    categoryPills.forEach(p => p.classList.remove("active"));
    pill.classList.add("active");
    
    activeCategory = pill.getAttribute("data-category");
    render();
  });

  // Tri par Importance
  sortImportanceBtn.addEventListener("click", () => {
    sortImportanceBtn.classList.add("active");
    sortTimeBtn.classList.remove("active");
    sortBy = "importance";
    render();
  });

  // Tri par Temps de lecture
  sortTimeBtn.addEventListener("click", () => {
    sortTimeBtn.classList.add("active");
    sortImportanceBtn.classList.remove("active");
    sortBy = "reading_time";
    render();
  });

  // ==========================================================================
  // APP BOOTSTRAPPING
  // ==========================================================================
  init();
});
