package com.beno74.shapescraper;

import android.app.Application;
import com.google.firebase.FirebaseApp;
import com.google.firebase.analytics.FirebaseAnalytics;
import java.util.EnumMap;

public class ShapescraperApplication extends Application {
    @Override public void onCreate() {
        super.onCreate();
        // FirebaseInitProvider is removed in the manifest. Never trust a persisted
        // collection-enabled flag from the previous process while UMP is unresolved.
        if (FirebaseApp.initializeApp(this) != null) {
            FirebaseAnalytics analytics = FirebaseAnalytics.getInstance(this);
            analytics.setAnalyticsCollectionEnabled(false);
            EnumMap<FirebaseAnalytics.ConsentType, FirebaseAnalytics.ConsentStatus> consent =
                new EnumMap<>(FirebaseAnalytics.ConsentType.class);
            for (FirebaseAnalytics.ConsentType type : FirebaseAnalytics.ConsentType.values()) {
                consent.put(type, FirebaseAnalytics.ConsentStatus.DENIED);
            }
            analytics.setConsent(consent);
        }
    }
}
