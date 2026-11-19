package com.beno74.shapescraper;

import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.ads.AgeRestrictedTreatment;
import com.google.android.gms.ads.MobileAds;
import com.google.android.play.agesignals.AgeSignalsManagerFactory;

@CapacitorPlugin(name = "RegionalAge")
public class RegionalAgePlugin extends Plugin {
    private RegionalAgeGate gate;
    @Override public void load() {
        gate = new RegionalAgeGate(AgeSignalsManagerFactory.create(getContext()), ContextCompat.getMainExecutor(getContext()));
    }
    @PluginMethod public void getRequirements(PluginCall call) {
        gate.requirements(decision -> respond(call, decision));
    }
    @PluginMethod public void requestRequiredAgeRange(PluginCall call) {
        getActivity().runOnUiThread(() -> gate.request(getActivity(), decision -> {
            if ("resolved".equals(decision.status) && decision.minor) {
                MobileAds.setRequestConfiguration(MobileAds.getRequestConfiguration().toBuilder()
                    .setAgeRestrictedTreatment(decision.childDirected ? AgeRestrictedTreatment.CHILD : AgeRestrictedTreatment.TEEN)
                    .build());
            }
            respond(call, decision);
            if ("verificationRequired".equals(decision.status)) showPlayResolution();
        }));
    }
    private void respond(PluginCall call, RegionalAgeGate.Decision decision) {
        JSObject result = new JSObject();
        result.put("status", decision.status);
        if ("resolved".equals(decision.status)) {
            result.put("minor", decision.minor);
            result.put("childDirected", decision.childDirected);
        }
        call.resolve(result);
    }
    private void showPlayResolution() {
        new AlertDialog.Builder(getActivity())
            .setTitle("Google Play verification")
            .setMessage("Complete age verification in Google Play, then reopen the game. You can keep playing without ads or analytics.")
            .setNegativeButton("Not now", (dialog, which) -> {})
            .setPositiveButton("Open Google Play", (dialog, which) -> {
                try {
                    getActivity().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + getContext().getPackageName()))
                        .setPackage("com.android.vending"));
                } catch (ActivityNotFoundException ignored) {
                    // Missing Play Store never becomes proof of an exemption.
                }
            }).show();
    }
}
