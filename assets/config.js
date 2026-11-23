// ============================================================
//  FLORIQA — réglages du site
//  C'est le seul fichier à modifier pour les réglages de base.
// ============================================================
window.FLORIQA_CONFIG = {
  // Connexion à la base de données (Supabase). Ces deux valeurs sont publiques
  // par nature : la sécurité est assurée par les règles de la base.
  supabaseUrl: "https://jzzxetoejcgzajekceos.supabase.co",
  supabaseKey: "sb_publishable_RibWp3Zu1Ih2y8pI6bOIKQ_FdWSwyHj",

  // Adresse e-mail qui reçoit une alerte à chaque nouvelle demande de booking.
  // Laisse vide ("") pour ne rien recevoir par e-mail (les demandes restent dans l'admin).
  // La toute première demande envoie un e-mail d'activation à cette adresse :
  // il faut cliquer sur le lien une fois pour activer les alertes.
  notifyEmail: "",

  // Phrase animée en haut à gauche
  logoLines: ["EVERY FLOWER", "IS OUR LOGO"],
};
