/**
 * Configurazione del progetto Supabase usato per la sincronizzazione delle FOTO tramite
 * Supabase Storage (vedi js/foto-sync.js): solo i blob delle foto passano da qui, i dati
 * testuali dei sopralluoghi restano su Firestore (vedi js/firebase-config.js). Come per
 * firebase-config.js, questi sono valori pubblici lato client (chiave anon/publishable): la
 * protezione è affidata alle policy di accesso configurate sul bucket Supabase, non alla
 * segretezza di questi valori.
 *
 * NOTA: il bucket non è marcato "Public" nel progetto Supabase (verificato: l'endpoint
 * /storage/v1/object/public/... risponde "Bucket not found"), per questo js/foto-sync.js legge
 * sempre le foto con lo stesso client autenticato con questa chiave anon (storage.download),
 * mai con l'URL pubblico nudo. L'URL pubblico viene comunque salvato accanto al percorso per
 * completezza: se in futuro il bucket verrà reso pubblico dal pannello Supabase, resta già
 * pronto all'uso diretto senza altre modifiche.
 */
const SUPABASE_URL = "https://twznfiygzzbqdgudpwav.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Ljz9zk26Q6_se1Zh28lENw_gOPQ14QW";
const SUPABASE_BUCKET = "foto-sopralluoghi";
