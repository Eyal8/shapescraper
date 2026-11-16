package com.beno74.shapescraper;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Read the UMP consent-mode signal; never infer analytics consent from ad eligibility. */
@CapacitorPlugin(name = "AnalyticsConsent")
public class AnalyticsConsentPlugin extends Plugin {
    @PluginMethod
    public void getConsentModes(PluginCall call) {
        String values = getContext().getSharedPreferences(
            getContext().getPackageName() + "_preferences", android.content.Context.MODE_PRIVATE
        ).getString("UMP_consentModeValues", "");
        JSObject result = new JSObject();
        result.put("values", values);
        call.resolve(result);
    }
}
