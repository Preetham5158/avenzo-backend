import { Stack } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";

export default function ProfileScreen() {
  const { user, logout, updateProfile, error, clearError } = useAuth();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.name ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  // Sync form fields when user state updates after a save
  useEffect(() => {
    if (!editing && user) {
      setName(user.name ?? "");
      setPhone(user.phone ?? "");
    }
  }, [user, editing]);

  async function handleSave() {
    clearError();
    setSaved(false);
    setBusy(true);
    try {
      await updateProfile(name.trim() || null, phone.trim() || null);
      setEditing(false);
      setSaved(true);
    } catch {
      // error set in auth context
    } finally {
      setBusy(false);
    }
  }

  function handleCancel() {
    clearError();
    setSaved(false);
    setName(user?.name ?? "");
    setPhone(user?.phone ?? "");
    setEditing(false);
  }

  if (!user) return null;

  const roleLabel = user.role === "USER" ? "Customer" : user.role;

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{ title: "My Profile", headerShown: true, headerBackVisible: false }} />
      <ScrollView contentContainerStyle={styles.content}>
        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {saved && !error ? (
          <View style={styles.successBox}>
            <Text style={styles.successText}>Profile updated.</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Field label="Email" value={user.email} />
          <Field label="Role" value={roleLabel} />

          {editing ? (
            <>
              <Text style={styles.label}>Name</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="Full name"
              />
              <Text style={styles.label}>Phone</Text>
              <TextInput
                style={styles.input}
                value={phone}
                onChangeText={setPhone}
                placeholder="Phone number"
                keyboardType="phone-pad"
              />
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={[styles.btn, styles.btnPrimary]}
                  onPress={handleSave}
                  disabled={busy}
                >
                  {busy ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.btnPrimaryText}>Save</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.btnSecondary]}
                  onPress={handleCancel}
                  disabled={busy}
                >
                  <Text style={styles.btnSecondaryText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Field label="Name" value={user.name ?? "—"} />
              <Field label="Phone" value={user.phone ?? "—"} />
              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary, { marginTop: 12 }]}
                onPress={() => {
                  clearError();
                  setSaved(false);
                  setEditing(true);
                }}
              >
                <Text style={styles.btnPrimaryText}>Edit profile</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
          <Text style={styles.logoutText}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  content: { padding: 20 },
  errorBox: { backgroundColor: "#FEF2F2", borderRadius: 8, padding: 12, marginBottom: 16 },
  errorText: { color: "#B91C1C", fontSize: 14 },
  successBox: { backgroundColor: "#F0FDF4", borderRadius: 8, padding: 12, marginBottom: 16 },
  successText: { color: "#166534", fontSize: 14 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  field: { marginBottom: 16 },
  label: { fontSize: 11, color: "#6B7280", fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 },
  value: { fontSize: 16, color: "#111827" },
  input: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    marginBottom: 12,
  },
  buttonRow: { flexDirection: "row", gap: 10 },
  btn: { flex: 1, borderRadius: 8, padding: 14, alignItems: "center" },
  btnPrimary: { backgroundColor: "#2563EB" },
  btnPrimaryText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  btnSecondary: { backgroundColor: "#F3F4F6" },
  btnSecondaryText: { color: "#374151", fontSize: 15, fontWeight: "600" },
  logoutBtn: { padding: 16, alignItems: "center", marginTop: 4 },
  logoutText: { color: "#DC2626", fontSize: 15, fontWeight: "600" },
});
